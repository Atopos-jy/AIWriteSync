/**
 * 知乎适配器 - 修复封面同步版
 */
import { CodeAdapter, type ImageUploadResult } from "../code-adapter";
import type {
  Article,
  AuthResult,
  SyncResult,
  PlatformMeta,
} from "../../types";
import type { PublishOptions } from "../types";
import { createLogger } from "../../lib/logger";
import { ArticleProcessor } from "../article-processor";
import md5Lib from "js-md5";

const logger = createLogger("Zhihu");
const jsMd5 = md5Lib as unknown as (
  message: string | ArrayBuffer | Uint8Array,
) => string;

export class ZhihuAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: "zhihu",
    name: "知乎",
    icon: "https://static.zhihu.com/static/favicon.ico",
    homepage: "https://www.zhihu.com",
    capabilities: ["article", "draft", "image_upload", "tags", "cover"],
  };

  readonly preprocessConfig = {
    outputFormat: "html" as const,
    removeSpecialTags: true,
    removeSpecialTagsWithParent: true,
    processCodeBlocks: true,
    convertSectionToDiv: true,
    removeTrailingBr: true,
    unwrapSingleChildContainers: true,
    unwrapNestedFigures: true,
    compactHtml: true,
    removeEmptyLines: true,
    removeEmptyDivs: true,
    removeNestedEmptyContainers: true,
  };

  private readonly HEADER_RULES = [
    {
      urlFilter: "*://www.zhihu.com/api/*",
      headers: { "x-requested-with": "fetch" },
      resourceTypes: ["xmlhttprequest"],
    },
    {
      urlFilter: "*://zhuanlan.zhihu.com/api/*",
      headers: { "x-requested-with": "fetch" },
      resourceTypes: ["xmlhttprequest"],
    },
    {
      urlFilter: "*://api.zhihu.com/*",
      headers: { "x-requested-with": "fetch" },
      resourceTypes: ["xmlhttprequest"],
    },
  ];

  async checkAuth(): Promise<AuthResult> {
    try {
      const response = await this.runtime.fetch(
        "https://www.zhihu.com/api/v4/me",
        {
          method: "GET",
          credentials: "include",
          headers: {
            "x-requested-with": "fetch",
          },
        },
      );

      const data = (await response.json()) as {
        id?: string;
        name?: string;
        avatar_url?: string;
      };

      if (data.id) {
        return {
          isAuthenticated: true,
          userId: data.id,
          username: data.name,
          avatar: data.avatar_url,
        };
      }

      return { isAuthenticated: false };
    } catch (error) {
      logger.debug("checkAuth: not logged in -", error);
      return { isAuthenticated: false, error: (error as Error).message };
    }
  }

  async publish(
    article: Article,
    options?: PublishOptions,
  ): Promise<SyncResult> {
    return this.withHeaderRules(this.HEADER_RULES, async () => {
      logger.info("Starting publish...");

      // 使用文章处理器处理内容（知乎使用 HTML 格式）
      const processed = ArticleProcessor.processHtmlContent(article, {
        supportsTags: false, // 知乎不支持标签
        supportsSummary: false,
        supportsCategory: false, // 知乎不支持分类
        supportsCover: true, // 知乎支持封面
        supportsAuthor: false, // 知乎使用账号作者
      });

      // 1. 创建草稿容器
      const createResponse = await this.runtime.fetch(
        "https://zhuanlan.zhihu.com/api/articles/drafts",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-requested-with": "fetch",
          },
          body: JSON.stringify({
            title: processed.title,
            content: "",
            delta_time: 0,
          }),
        },
      );

      const responseText = await createResponse.text();
      if (!createResponse.ok) {
        throw new Error(`创建草稿失败: ${createResponse.status}`);
      }

      const createData = JSON.parse(responseText);
      const draftId = createData.id;
      logger.debug("Draft created:", draftId);

      let content = processed.content;
      content = await this.processImages(
        content,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: ["zhimg.com"],
          onProgress: options?.onImageProgress,
        },
      );

      content = this.transformContent(content);

      // 4. 处理封面图 (核心修复部分)
      let coverImageUrl: string | undefined;
      if (processed.cover) {
        try {
          logger.info(`[Zhihu] 正在处理封面: ${processed.cover}`);
          const coverResp = await this.runtime.fetch(processed.cover);
          if (coverResp.ok) {
            const coverBlob = await coverResp.blob();
            // 复用内部二进制上传逻辑，确保拿到 zhimg 域名的 URL
            coverImageUrl = await this.uploadImageBinaryInternal(coverBlob);
            logger.info(`[Zhihu] 封面上传成功: ${coverImageUrl}`);
          }
        } catch (err) {
          logger.error(`[Zhihu] 封面同步失败:`, err);
        }
      }

      // 5. 更新草稿内容与封面
      const updateBody: any = {
        title: processed.title,
        content: content,
        delta_time: 1,
      };

      if (coverImageUrl) {
        updateBody.titleImage = `${coverImageUrl}?source=1940ef5c`;
        updateBody.isTitleImageFullScreen = false;
      }

      const updateResponse = await this.runtime.fetch(
        `https://zhuanlan.zhihu.com/api/articles/${draftId}/draft`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-requested-with": "fetch",
          },
          body: JSON.stringify(updateBody),
        },
      );

      if (!updateResponse.ok) {
        const errorTxt = await updateResponse.text();
        throw new Error(`更新草稿失败: ${updateResponse.status} ${errorTxt}`);
      }

      const draftUrl = `https://zhuanlan.zhihu.com/p/${draftId}/edit`;
      return this.createResult(true, {
        postId: draftId,
        postUrl: draftUrl,
        draftOnly: true,
      });
    }).catch((error) =>
      this.createResult(false, {
        error: (error as Error).message,
      }),
    );
  }

  private transformContent(content: string): string {
    let result = content;
    result = this.transformTables(result);
    // 知乎需要 figure 标签包裹 img
    result = result.replace(
      /<img([^>]+)src="([^"]+)"([^>]*)>/gi,
      '<figure><img$1src="$2"$3></figure>',
    );
    // 代码块格式适配
    result = result.replace(
      /<pre><code class="language-(\w+)">/gi,
      '<pre lang="$1"><code>',
    );
    // 清理无关属性
    result = result.replace(/\s*data-(?!draft)[a-z-]+="[^"]*"/gi, "");
    result = result.replace(/\s*style="[^"]*"/gi, "");
    return result;
  }

  private transformTables(html: string): string {
    let result = html.replace(
      /<figure[^>]*>\s*(<table[\s\S]*?<\/table>)\s*<\/figure>/gi,
      "$1",
    );
    result = result.replace(
      /<table[^>]*>([\s\S]*?)<\/table>/gi,
      (_match, tableContent) => {
        const theadMatch = tableContent.match(
          /<thead[^>]*>([\s\S]*?)<\/thead>/i,
        );
        const tbodyMatch = tableContent.match(
          /<tbody[^>]*>([\s\S]*?)<\/tbody>/i,
        );
        let headerRows = "",
          bodyRows = "";

        if (theadMatch) {
          headerRows = theadMatch[1]
            .replace(/<td([^>]*)>/gi, "<th$1>")
            .replace(/<\/td>/gi, "</th>");
        }
        if (tbodyMatch) {
          bodyRows = tbodyMatch[1];
        } else {
          bodyRows = tableContent.replace(
            /<thead[^>]*>[\s\S]*?<\/thead>/gi,
            "",
          );
        }
        return `<table data-draft-node="block" data-draft-type="table" data-size="normal" data-row-style="normal"><tbody>${headerRows}${bodyRows}</tbody></table>`;
      },
    );
    return result;
  }

  private async calcFileHash(file: Blob): Promise<string> {
    const buffer = await file.arrayBuffer();
    return jsMd5(buffer);
  }

  async uploadImage(file: Blob, _filename?: string): Promise<string> {
    return this.uploadImageBinaryInternal(file);
  }

  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    if (src.startsWith("data:")) {
      const blob = await fetch(src).then((r) => r.blob());
      const url = await this.uploadImageBinaryInternal(blob);
      return { url };
    }

    const response = await this.runtime.fetch(
      "https://zhuanlan.zhihu.com/api/uploaded_images",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "x-requested-with": "fetch",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ url: src, source: "article" }),
      },
    );

    const data = (await response.json()) as { src?: string };
    if (data.src) return { url: data.src };
    throw new Error("图片URL转换失败");
  }

  /**
   * 核心二进制上传逻辑：支持秒传与 OSS 上传
   */
  private async uploadImageBinaryInternal(file: Blob): Promise<string> {
    const imageHash = await this.calcFileHash(file);

    // 1. 获取上传凭证
    const tokenResponse = await this.runtime.fetch(
      "https://api.zhihu.com/images",
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_hash: imageHash, source: "article" }),
      },
    );

    const tokenData = (await tokenResponse.json()) as any;
    const uploadFile = tokenData.upload_file;

    // 2. 如果 state 为 1 (秒传) 或执行了 OSS 上传后，都需要调用查询接口拿真正的 URL
    if (uploadFile.state !== 1) {
      await this.ossUpload(
        "https://zhihu-pics-upload.zhimg.com",
        uploadFile.object_key,
        file,
        tokenData.upload_token,
      );
    }

    // 关键修复：不要自己拼 URL，去查一下这个 image_id 对应的真实文件名
    try {
      const imgInfo = await this.waitForImageReady(uploadFile.image_id);
      // imgInfo.original_hash 才是像 v2-9057e195904a6df3492c6b89d50955f3 这样的东西
      const extension = file.type === "image/gif" ? "gif" : "jpg";
      return `https://pic4.zhimg.com/${imgInfo.original_hash}.${extension}`;
    } catch (e) {
      // 兜底方案：如果查询失败，尝试使用 object_key
      return `https://pic4.zhimg.com/${uploadFile.object_key}`;
    }
  }

  /**
   * 等待图片处理完成并获取原始 Hash (文件名)
   */
  private async waitForImageReady(
    imageId: string,
  ): Promise<{ original_hash: string }> {
    const maxRetries = 5;
    for (let i = 0; i < maxRetries; i++) {
      const response = await this.runtime.fetch(
        `https://api.zhihu.com/images/${imageId}`,
        { credentials: "include" },
      );
      if (response.ok) {
        const data = (await response.json()) as any;
        if (data.original_hash) {
          return { original_hash: data.original_hash };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    throw new Error("获取图片真实Hash超时");
  }

  private async ossUpload(
    endpoint: string,
    objectKey: string,
    blob: Blob,
    token: { access_id: string; access_key: string; access_token: string },
  ): Promise<void> {
    const contentType = blob.type || "application/octet-stream";
    const url = `${endpoint}/${objectKey}`;
    const date = new Date().toUTCString();

    const ossHeaders: Record<string, string> = {
      "x-oss-date": date,
      "x-oss-security-token": token.access_token,
    };

    const canonicalHeaders = Object.keys(ossHeaders)
      .sort()
      .map((k) => `${k}:${ossHeaders[k]}`)
      .join("\n");

    const resource = `/zhihu-pics/${objectKey}`;
    const sign = `PUT\n\n${contentType}\n${date}\n${canonicalHeaders}\n${resource}`;
    const signature = await this.hmacSha1Base64(token.access_key, sign);
    const auth = `OSS ${token.access_id}:${signature}`;

    await this.runtime.fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        Authorization: auth,
        ...ossHeaders,
      },
      body: blob,
    });
  }

  private async hmacSha1Base64(key: string, msg: string): Promise<string> {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(key),
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(msg));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  }
}
