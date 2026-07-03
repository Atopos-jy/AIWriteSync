/**
 * 微博适配器
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
import { parseMarkdownImages } from "../../lib/markdown-images";
import { ArticleProcessor } from "../article-processor";

const logger = createLogger("Weibo");

interface WeiboUserConfig {
  uid: string;
  nick: string;
  avatar_large: string;
}

export class WeiboAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: "weibo",
    name: "微博",
    icon: "https://weibo.com/favicon.ico",
    homepage: "https://card.weibo.com/article/v5/editor",
    capabilities: ["article", "draft", "image_upload", "cover"],
  };

  /** 预处理配置: 微博使用 HTML 格式 */
  readonly preprocessConfig = {
    outputFormat: "html" as const,
  };

  private userConfig: WeiboUserConfig | null = null;

  /** 微博 API 需要的 Header 规则 */
  private readonly HEADER_RULES = [
    {
      urlFilter: "*://card.weibo.com/*",
      headers: {
        Origin: "https://card.weibo.com",
        Referer: "https://card.weibo.com/article/v5/editor",
      },
      resourceTypes: ["xmlhttprequest"],
    },
    {
      urlFilter: "*://picupload.weibo.com/*",
      headers: {
        Origin: "https://weibo.com",
        Referer: "https://weibo.com/",
      },
      resourceTypes: ["xmlhttprequest"],
    },
  ];

  async checkAuth(): Promise<AuthResult> {
    try {
      const config = await this.getUserConfig();

      if (config?.uid) {
        return {
          isAuthenticated: true,
          userId: config.uid,
          username: config.nick,
          avatar: config.avatar_large,
        };
      }

      return { isAuthenticated: false };
    } catch (error) {
      logger.debug("checkAuth: not logged in -", error);
      return { isAuthenticated: false, error: (error as Error).message };
    }
  }

  /**
   * 获取用户配置 (从编辑器页面解析)
   */
  private async getUserConfig(): Promise<WeiboUserConfig | null> {
    if (this.userConfig) {
      return this.userConfig;
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debug(`Fetching config (attempt ${attempt}/${maxRetries})`);

        const response = await this.runtime.fetch(
          "https://card.weibo.com/article/v5/editor",
          {
            credentials: "include",
            headers: {
              "Cache-Control": "no-cache",
            },
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const html = await response.text();

        if (!html || html.length < 1000) {
          throw new Error("Incomplete HTML content received");
        }

        // 检查页面是否包含关键元素，确保页面加载完整
        if (!html.includes("card.weibo.com") && !html.includes("article")) {
          throw new Error("Page content appears to be incomplete");
        }

        // 尝试多种匹配模式，提高兼容性
        let configMatch: RegExpMatchArray | null = null;

        // 模式1: config: JSON.parse('...')
        configMatch = html.match(/config:\s*JSON\.parse\('(.+?)'\)/);

        // 模式2: window.$CONFIG = {...}
        if (!configMatch) {
          configMatch = html.match(/window\.\$CONFIG\s*=\s*({[\s\S]*?});/);
        }

        // 模式3: $CONFIG = {...}
        if (!configMatch) {
          configMatch = html.match(/\$CONFIG\s*=\s*({[\s\S]*?});/);
        }

        // 模式4: var config = {...}
        if (!configMatch) {
          configMatch = html.match(/var\s+config\s*=\s*({[\s\S]*?});/);
        }

        // 模式5: config = {...}
        if (!configMatch) {
          configMatch = html.match(/config\s*=\s*({[\s\S]*?});/);
        }

        if (!configMatch) {
          throw new Error("Config pattern not found in HTML");
        }

        let configJson = configMatch[1];

        // 处理不同格式的JSON字符串
        if (configJson.startsWith("'")) {
          configJson = configJson.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
        }

        const config = JSON.parse(configJson);

        if (!config.uid) {
          throw new Error("Config found but missing uid");
        }

        this.userConfig = {
          uid: String(config.uid),
          nick: config.nick || "",
          avatar_large: config.avatar_large || "",
        };

        logger.debug("User config retrieved successfully");
        return this.userConfig;
      } catch (e) {
        lastError = e as Error;
        logger.warn(`Config fetch attempt ${attempt} failed:`, e);

        if (attempt < maxRetries) {
          // 等待后重试
          await this.delay(1000 * attempt);
        }
      }
    }

    logger.error(
      "Failed to retrieve config after multiple attempts:",
      lastError,
    );
    return null;
  }

  async publish(
    article: Article,
    options?: PublishOptions,
  ): Promise<SyncResult> {
    return this.withHeaderRules(this.HEADER_RULES, async () => {
      logger.info("Starting publish...");

      const config = await this.getUserConfig();
      if (!config?.uid) {
        throw new Error("请先登录微博");
      }

      // 使用文章处理器处理内容（微博使用 HTML 格式）
      const processed = ArticleProcessor.processHtmlContent(article, {
        supportsTags: false, // 微博不支持标签字段，需拼接到内容中
        supportsSummary: true, // 微博支持摘要
        supportsCategory: false, // 微博不支持分类字段
        supportsCover: true, // 微博支持封面
        supportsAuthor: true, // 微博支持作者字段
      });

      let content = processed.content;
      content = content.replace(/>\s+</g, "><");
      content = await this.processWeiboImages(
        content,
        options?.onImageProgress,
      );

      const createReqId = this.generateReqId();
      const createResponse = await this.runtime.fetch(
        `https://card.weibo.com/article/v5/aj/editor/draft/create?uid=${config.uid}&_rid=${createReqId}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            accept: "application/json, text/plain, */*",
            "SN-REQID": createReqId,
          },
          body: new URLSearchParams({}),
        },
      );
      const createRes = (await createResponse.json()) as {
        code: number;
        msg?: string;
        data?: { id: string };
      };

      if (createRes.code !== 100000 || !createRes.data?.id) {
        throw new Error(createRes.msg || "创建草稿失败");
      }

      const postId = createRes.data.id;
      logger.debug("Created draft:", postId);

      let coverUrl = "";
      if (processed.cover) {
        try {
          const coverResult = await this.uploadImageByUrl(processed.cover);
          coverUrl = coverResult.url;
        } catch (e) {
          logger.warn("Failed to upload cover:", e);
        }
      }

      const saveReqId = this.generateReqId();
      const saveResponse = await this.runtime.fetch(
        `https://card.weibo.com/article/v5/aj/editor/draft/save?uid=${config.uid}&id=${postId}&_rid=${saveReqId}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            accept: "application/json, text/plain, */*",
            "SN-REQID": saveReqId,
          },
          body: new URLSearchParams({
            id: postId,
            title: processed.title,
            subtitle: "",
            type: "",
            status: "0",
            publish_at: article.publishDate || "",
            error_msg: "",
            error_code: "0",
            collection: "[]",
            free_content: "",
            content: content,
            cover: coverUrl,
            summary: processed.summary || "",
            writer: article.author || "",
            extra: "null",
            is_word: "0",
            article_recommend: "[]",
            follow_to_read: "1",
            isreward: "1",
            pay_setting: '{"ispay":0,"isvclub":0}',
            source: "0",
            action: "1",
            content_type: "0",
            save: "1",
          }),
        },
      );
      const saveRes = (await saveResponse.json()) as {
        code: string | number;
        msg?: string;
      };

      logger.debug("Save response:", saveRes);

      const code = String(saveRes.code);
      if (code !== "100000") {
        throw new Error(saveRes.msg || `保存失败 (错误码: ${code})`);
      }

      const draftUrl = `https://card.weibo.com/article/v5/editor#/draft/${postId}`;

      return this.createResult(true, {
        postId: postId,
        postUrl: draftUrl,
        draftOnly: options?.draftOnly ?? true,
      });
    }).catch((error) =>
      this.createResult(false, {
        error: (error as Error).message,
      }),
    );
  }

  private generateReqId(): string {
    const input = `${this.userConfig?.uid}&${Date.now()}`;
    const base64 = btoa(input)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let result = base64;
    while (result.length < 43) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result.slice(0, 43);
  }

  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    if (src.startsWith("data:")) {
      logger.debug("Uploading data URI image via direct upload");
      return this.uploadDataUri(src);
    }

    const config = await this.getUserConfig();
    if (!config?.uid) {
      throw new Error("请先登录微博");
    }

    const reqId = this.generateReqId();

    try {
      const uploadRes = await this.runtime.fetch(
        `https://card.weibo.com/article/v5/aj/editor/plugins/asyncuploadimg?uid=${config.uid}&_rid=${reqId}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            accept: "application/json, text/plain, */*",
            "SN-REQID": reqId,
          },
          body: new URLSearchParams({ "urls[0]": src }),
        },
      );

      const uploadData = await uploadRes.json();
      logger.debug("Async upload response:", uploadData);
    } catch (e) {
      logger.warn("Async upload request failed, will try polling anyway:", e);
    }

    const imgDetail = await this.waitForImageDone(src);
    const imgUrl = `https://wx3.sinaimg.cn/large/${imgDetail.pid}.jpg`;

    return {
      url: imgUrl,
      attrs: {
        "data-pid": imgDetail.pid,
      },
    };
  }

  async uploadImageBase64(
    imageData: string,
    mimeType: string,
  ): Promise<ImageUploadResult> {
    const dataUri = `data:${mimeType};base64,${imageData}`;
    return this.uploadDataUri(dataUri);
  }

  private async uploadDataUri(dataUri: string): Promise<ImageUploadResult> {
    const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error("Invalid data URI format");
    }

    const mimeType = match[1];
    const base64Data = match[2];

    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });

    logger.debug(`Uploading blob: ${mimeType}, size: ${blob.size}`);

    const reqId = this.generateReqId();
    const uploadUrl = `https://picupload.weibo.com/interface/pic_upload.php?app=miniblog&s=json&p=1&data=1&url=&markpos=1&logo=0&nick=&file_source=4&_rid=${reqId}`;

    const response = await this.runtime.fetch(uploadUrl, {
      method: "POST",
      credentials: "include",
      body: blob,
    });

    const result = (await response.json()) as {
      code?: string;
      data?: {
        pics?: {
          pic_1?: {
            pid: string;
            width: number;
            height: number;
          };
        };
      };
    };

    logger.debug("Direct upload response:", result);

    if (!result.data?.pics?.pic_1?.pid) {
      throw new Error("图片上传失败: " + JSON.stringify(result));
    }

    const pid = result.data.pics.pic_1.pid;
    const imgUrl = `https://wx3.sinaimg.cn/large/${pid}.jpg`;

    return {
      url: imgUrl,
      attrs: {
        "data-pid": pid,
      },
    };
  }

  private async processWeiboImages(
    content: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<string> {
    // Content is pre-processed, use directly
    const processedContent = content;

    const figureImgRegex =
      /<figure[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>[\s\S]*?<\/figure>/gi;
    const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
    const matches: { full: string; src: string; hasFigure: boolean }[] = [];

    let match;
    const figureMatches = new Set<string>();
    while ((match = figureImgRegex.exec(processedContent)) !== null) {
      matches.push({ full: match[0], src: match[1], hasFigure: true });
      figureMatches.add(match[1]);
    }

    while ((match = imgRegex.exec(processedContent)) !== null) {
      if (!figureMatches.has(match[1])) {
        matches.push({ full: match[0], src: match[1], hasFigure: false });
      }
    }

    for (const mdMatch of parseMarkdownImages(processedContent)) {
      matches.push({ full: mdMatch.full, src: mdMatch.src, hasFigure: false });
    }

    if (matches.length === 0) {
      return processedContent;
    }

    logger.info(`Found ${matches.length} images to process`);

    let result = processedContent;
    const uploadedMap = new Map<string, { pid: string; url: string }>();
    let processed = 0;

    for (const { full, src, hasFigure } of matches) {
      if (!src) continue;

      if (src.includes("sinaimg.cn") || src.includes("weibo.com")) {
        logger.debug(`Skipping weibo image: ${src}`);
        continue;
      }

      if (src.startsWith("data:")) {
        continue;
      }

      processed++;
      onProgress?.(processed, matches.length);

      try {
        let imgInfo = uploadedMap.get(src);

        if (!imgInfo) {
          logger.debug(
            `Uploading image ${processed}/${matches.length}: ${src}`,
          );
          const uploadResult = await this.uploadImageByUrl(src);
          const pid = (uploadResult.attrs?.["data-pid"] as string) || "";
          imgInfo = { pid, url: uploadResult.url };
          uploadedMap.set(src, imgInfo);
        }

        let replacement: string;
        if (hasFigure) {
          replacement = full.replace(
            /<img[^>]+src="[^"]+"[^>]*>/i,
            `<img src="${imgInfo.url}" data-pid="${imgInfo.pid}" />`,
          );
        } else {
          replacement = `<figure class="image"><img src="${imgInfo.url}" data-pid="${imgInfo.pid}" /></figure>`;
        }

        result = result.replace(full, replacement);
        logger.debug(`Image uploaded: ${imgInfo.url}`);
      } catch (error) {
        logger.error(`Failed to upload image: ${src}`, error);
      }

      await this.delay(300);
    }

    return result;
  }

  private async waitForImageDone(src: string): Promise<{
    pid: string;
    url: string;
    task_status_code: number;
  }> {
    const config = await this.getUserConfig();
    const maxAttempts = 30;

    for (let i = 0; i < maxAttempts; i++) {
      const reqId = this.generateReqId();
      const response = await this.runtime.fetch(
        `https://card.weibo.com/article/v5/aj/editor/plugins/asyncimginfo?uid=${config!.uid}&_rid=${reqId}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            accept: "application/json, text/plain, */*",
            "SN-REQID": reqId,
          },
          body: new URLSearchParams({ "urls[0]": src }),
        },
      );

      const res = (await response.json()) as {
        data?: Array<{ pid: string; url: string; task_status_code: number }>;
      };

      const item = res.data?.[0];
      const statusCode = item?.task_status_code;
      if (statusCode === 1 && item) {
        logger.debug("Image upload complete:", item);
        return item;
      }

      if (statusCode === 2) {
        // task_status_code === 2 表示失败，不要继续轮询
        throw new Error("图片上传失败");
      }

      await this.delay(1000);
    }

    throw new Error("图片上传超时");
  }
}
