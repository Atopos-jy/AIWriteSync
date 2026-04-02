/**
 * 掘金适配器 - 标准同步实现
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
import { signAWS4, crc32 } from "../../lib";

const logger = createLogger("Juejin");

// ImageX 服务常量
const IMAGEX_AID = "2608";
const IMAGEX_SERVICE_ID = "73owjymdk6";

// 生成标准 v4 UUID (用于 ImageX API)
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// 接口定义
interface ImageXTokenResponse {
  data?: {
    token: {
      AccessKeyId: string;
      SecretAccessKey: string;
      SessionToken: string;
      ExpiredTime: string;
      CurrentTime: string;
    };
  };
  err_no?: number;
  err_msg?: string;
}

interface ImageXToken {
  AccessKeyId: string;
  SecretAccessKey: string;
  SessionToken: string;
  ExpiredTime: number;
}

interface ImageXApplyUploadResponse {
  Result: {
    UploadAddress: {
      StoreInfos: Array<{ StoreUri: string; Auth: string; UploadID: string }>;
      UploadHosts: string[];
      SessionKey: string;
    };
  };
}

export class JuejinAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: "juejin",
    name: "掘金",
    icon: "https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/favicon-32x32.png",
    homepage: "https://juejin.cn",
    capabilities: [
      "article",
      "draft",
      "image_upload",
      "categories",
      "tags",
      "cover",
    ],
  };

  readonly preprocessConfig = { outputFormat: "markdown" as const };

  private cachedCsrfToken: string | null = null;
  private cachedImageXToken: ImageXToken | null = null;
  private imageXTokenExpiry: number = 0;
  private uuid: string = generateUUID();

  private readonly HEADER_RULES = [
    {
      urlFilter: "*://api.juejin.cn/*",
      headers: { Origin: "https://juejin.cn", Referer: "https://juejin.cn/" },
      resourceTypes: ["xmlhttprequest"],
    },
    {
      urlFilter: "*://imagex.bytedanceapi.com/*",
      headers: { Origin: "https://juejin.cn", Referer: "https://juejin.cn/" },
      resourceTypes: ["xmlhttprequest"],
    },
  ];

  async checkAuth(): Promise<AuthResult> {
    try {
      console.log("[Juejin] 开始身份验证...");
      const response = await this.runtime.fetch(
        "https://api.juejin.cn/user_api/v1/user/get",
        {
          method: "GET",
          credentials: "include",
        },
      );
      console.log("[Juejin] 身份验证响应状态:", response.status);
      const data = await response.json();
      console.log("[Juejin] 身份验证响应数据:", data);
      if (data.data?.user_id) {
        console.log("[Juejin] 身份验证成功:", data.data.user_name);
        return {
          isAuthenticated: true,
          userId: data.data.user_id,
          username: data.data.user_name,
          avatar: data.data.avatar_large,
        };
      }
      console.log("[Juejin] 身份验证失败: 没有用户ID");
      return { isAuthenticated: false };
    } catch (error) {
      console.error("[Juejin] 身份验证错误:", error);
      return { isAuthenticated: false, error: (error as Error).message };
    }
  }

  /**
   * 获取 CSRF Token - 多种方式组合获取
   */
  private async getCsrfToken(): Promise<string> {
    if (this.cachedCsrfToken) {
      return this.cachedCsrfToken;
    }

    // 方法1: 直接从浏览器Cookie读取（仿照简书实现）
    try {
      if (this.runtime.cookies && this.runtime.cookies.get) {
        const cookies = await this.runtime.cookies.get(".juejin.cn");

        // 尝试多种可能的Cookie名称
        const possibleNames = [
          "passport_csrf_token",
          "passport_csrf_token_default",
          "csrfToken",
          "x-secsdk-csrf-token",
          "X-SecSDK-CSRF-Token",
          "csrf-token",
          "_csrf",
          "token",
          "X-Ware-Csrf-Token",
          "csrf_session_id",
        ];

        for (const name of possibleNames) {
          const cookie = cookies.find((c) => c.name === name);
          if (cookie && cookie.value) {
            this.cachedCsrfToken = cookie.value;
            console.log(
              `[Juejin] 从Cookie获取到Token (${name}):`,
              this.cachedCsrfToken,
            );
            return this.cachedCsrfToken;
          }
        }

        // 输出所有Cookie名称以便调试
        const cookieNames = cookies.map((c) => c.name).join(", ");
        console.log("[Juejin] 所有Cookie名称:", cookieNames);
      } else {
        console.error("[Juejin] runtime.cookies.get 方法不可用");
      }
    } catch (error) {
      console.error("[Juejin] 方法1失败:", error);
    }

    // 方法2: 调用API获取响应头中的X-Ware-Csrf-Token
    try {
      console.log("[Juejin] 方法2: 调用API获取响应头中的X-Ware-Csrf-Token");
      const response = await this.runtime.fetch(
        "https://api.juejin.cn/user_api/v1/user/get",
        {
          method: "GET",
          credentials: "include",
          headers: {
            Origin: "https://juejin.cn",
            Referer: "https://juejin.cn/",
          },
        },
      );

      console.log("[Juejin] API响应状态:", response.status);

      // 尝试获取响应头中的X-Ware-Csrf-Token
      const wareToken =
        response.headers.get("x-ware-csrf-token") ||
        response.headers.get("X-Ware-Csrf-Token");

      if (wareToken) {
        // 掘金的Token格式通常是 "0,token_value"
        const parts = wareToken.split(",");
        this.cachedCsrfToken = parts.length >= 2 ? parts[1] : wareToken;
        console.log("[Juejin] 解析后的Token:", this.cachedCsrfToken);
        return this.cachedCsrfToken;
      }
    } catch (error) {
      console.error("[Juejin] 方法2失败:", error);
    }

    // 方法3: 访问掘金编辑器页面，提取页面中的Token（备用方法）
    try {
      const response = await this.runtime.fetch(
        "https://juejin.cn/editor/drafts/new",
        {
          method: "GET",
          credentials: "include",
          headers: {
            Origin: "https://juejin.cn",
            Referer: "https://juejin.cn/",
          },
        },
      );

      console.log("[Juejin] 编辑器页面响应状态:", response.status);
      const html = await response.text();

      // 尝试多种模式提取Token
      const patterns = [
        /csrfToken\s*=\s*['"]([^'"]+)['"]/,
        /x-secsdk-csrf-token\s*=\s*['"]([^'"]+)['"]/,
        /csrf-token\s*=\s*['"]([^'"]+)['"]/,
        /_csrf\s*=\s*['"]([^'"]+)['"]/,
        /X-Ware-Csrf-Token\s*=\s*['"]([^'"]+)['"]/,
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
          this.cachedCsrfToken = match[1];
          console.log(
            `[Juejin] 从页面内容提取到 Token (模式: ${pattern.source}):`,
            this.cachedCsrfToken,
          );
          return this.cachedCsrfToken;
        }
      }
    } catch (error) {
      console.error("[Juejin] 方法3失败:", error);
    }

    // 所有方法都失败
    console.error("[Juejin] 所有获取CSRF Token的方法都失败了");
    throw new Error("无法获取掘金 CSRF Token，请检查是否已登录掘金账号");
  }

  private async getValidCategoryId(categoryName?: string): Promise<string> {
    console.log("[Juejin] 获取分类 ID，分类名称:", categoryName);
    try {
      const res = await this.runtime.fetch(
        "https://api.juejin.cn/tag_api/v1/query_category_briefs",
        {
          method: "GET",
          credentials: "include",
        },
      );
      console.log("[Juejin] 分类列表响应状态:", res.status);
      const { data } = await res.json();
      console.log("[Juejin] 分类列表数据:", data);
      const match = data.find((c: any) => c.category_name === categoryName);
      const categoryId = match ? match.category_id : "6809635626879549454"; // 默认：前端
      console.log("[Juejin] 使用分类 ID:", categoryId);
      return categoryId;
    } catch (error) {
      console.error("[Juejin] 获取分类 ID 失败:", error);
      return "6809635626879549454";
    }
  }

  private async convertTagsToIds(tags: string[]): Promise<string[]> {
    console.log("[Juejin] 转换标签为 ID:", tags);
    if (!tags || tags.length === 0) {
      console.log("[Juejin] 没有标签，使用默认标签");
      return ["6809640407484334093"]; // 默认：程序员
    }
    const ids: string[] = [];
    try {
      for (const tag of tags.slice(0, 3)) {
        console.log("[Juejin] 搜索标签:", tag);
        const res = await this.runtime.fetch(
          `https://api.juejin.cn/tag_api/v1/query_tag?key_word=${encodeURIComponent(tag)}&cursor=0&count=1`,
          { method: "GET", credentials: "include" },
        );
        console.log("[Juejin] 标签搜索响应状态:", res.status);
        const data = await res.json();
        console.log("[Juejin] 标签搜索数据:", data);
        if (data.data && data.data.length > 0) {
          ids.push(data.data[0].tag_id);
          console.log("[Juejin] 找到标签 ID:", data.data[0].tag_id);
        } else {
          console.log("[Juejin] 标签未找到:", tag);
        }
      }
    } catch (error) {
      console.error("[Juejin] 标签转换失败:", error);
    }
    const finalIds = ids.length > 0 ? ids : ["6809640407484334093"];
    console.log("[Juejin] 最终标签 ID 列表:", finalIds);
    return finalIds;
  }

  async publish(
    article: Article,
    options?: PublishOptions,
  ): Promise<SyncResult> {
    try {
      console.log("[Juejin] 开始同步流程...");

      // Step 1: 获取 CSRF Token
      console.log("[Juejin] Step 1: 获取 CSRF Token");
      const csrfToken = await this.getCsrfToken();

      // Step 2: 使用文章处理器处理内容

      const processed = ArticleProcessor.processContent(article, {
        supportsTags: true, // 掘金支持标签
        supportsSummary: true, // 掘金支持摘要
        supportsCategory: true, // 掘金支持分类
        supportsCover: true, // 掘金支持封面
        supportsAuthor: false, // 掘金使用账号作者
      });

      // Step 3: 获取分类 ID（使用处理后的分类）
      const categoryId = await this.getValidCategoryId(processed.category);

      // Step 4: 转换标签为 ID（使用处理后的标签）
      const tagIds = await this.convertTagsToIds(processed.tags);

      // Step 5: 处理封面图（使用处理后的封面）
      let coverImage = processed.cover || "";
      if (coverImage && !coverImage.includes("juejin.cn")) {
        const uploadRes = await this.uploadImageByUrl(coverImage);
        coverImage = uploadRes.url;
      }

      let markdown = processed.content;

      // Step 6: 处理图片转存
      markdown = await this.processImages(
        markdown,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: ["juejin.cn", "byteimg.com"],
          onProgress: options?.onImageProgress,
        },
      );

      // 使用 Header 规则保护 API 请求
      return this.withHeaderRules(this.HEADER_RULES, async () => {
        // Step 7: 创建草稿
        const createResponse = await this.runtime.fetch(
          `https://api.juejin.cn/content_api/v1/article_draft/create?aid=${IMAGEX_AID}&uuid=${this.uuid}`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "x-secsdk-csrf-token": csrfToken,
              "x-secsdk-csrf-version": "1.2.10",
            },
            body: JSON.stringify({
              title: processed.title,
            }),
          },
        );

        const createData = await createResponse.json();

        if (!createData.data?.id) {
          throw new Error(`创建草稿失败: ${createData.err_msg || "未知错误"}`);
        }

        const draftId = createData.data.id;

        // 判断文章类型
        const isOriginal =
          processed.articleType === "original" ||
          processed.articleType === "原创";

        // Step 8: 更新草稿内容
        const updateResponse = await this.runtime.fetch(
          `https://api.juejin.cn/content_api/v1/article_draft/update?aid=${IMAGEX_AID}&uuid=${this.uuid}`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "x-secsdk-csrf-token": csrfToken,
              "x-secsdk-csrf-version": "1.2.10",
            },
            body: JSON.stringify({
              id: draftId,
              title: processed.title,
              brief_content: (processed.summary || processed.title).substring(
                0,
                100,
              ),
              mark_content: markdown,
              html_content: "",
              category_id: categoryId,
              tag_ids: tagIds,
              cover_image: coverImage,
              link_url: article.url || "",
              edit_type: 10,
              origin_type: isOriginal ? 0 : 1,
              status: 0,
              pics: [],
              theme_ids: [],
              is_gfw: 0,
              is_english: 0,
              original_type: isOriginal ? 0 : 1,
            }),
          },
        );

        console.log("[Juejin] 更新草稿响应状态:", updateResponse.status);
        const updateData = await updateResponse.json();
        console.log("[Juejin] 更新草稿响应数据:", updateData);

        if (updateData.err_no !== 0) {
          throw new Error(`更新草稿失败: ${updateData.err_msg || "未知错误"}`);
        }

        // Step 9: 返回结果
        return this.createResult(true, {
          postId: draftId,
          postUrl: `https://juejin.cn/editor/drafts/${draftId}`,
          draftOnly: true,
        });
      });
    } catch (error) {
      console.error("[Juejin] 同步失败:", error);
      return this.createResult(false, { error: (error as Error).message });
    }
  }

  // --- 图片上传相关逻辑 (ImageX 流程) ---

  async uploadImage(file: Blob): Promise<string> {
    return this.withHeaderRules(this.HEADER_RULES, () =>
      this.uploadImageBinaryInternal(file),
    );
  }

  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    try {
      const response = await this.runtime.fetch(src, { method: "GET" });
      if (!response.ok) return { url: src };
      const blob = await response.blob();
      const url = await this.uploadImageBinaryInternal(blob);
      return { url };
    } catch (error) {
      logger.warn("图片上传失败:", src, error);
      return { url: src };
    }
  }

  private async getImageXToken(): Promise<ImageXToken> {
    if (this.cachedImageXToken && Date.now() < this.imageXTokenExpiry - 60000) {
      return this.cachedImageXToken;
    }
    const url = `https://api.juejin.cn/imagex/v2/gen_token?aid=${IMAGEX_AID}&uuid=${this.uuid}&client=web`;
    const response = await this.runtime.fetch(url, {
      method: "GET",
      credentials: "include",
    });
    const data = (await response.json()) as ImageXTokenResponse;
    if (data.err_no !== 0 || !data.data?.token)
      throw new Error("获取 ImageX 凭证失败");

    const tokenData = data.data.token;
    const expiredTime = new Date(tokenData.ExpiredTime).getTime();
    this.cachedImageXToken = {
      AccessKeyId: tokenData.AccessKeyId,
      SecretAccessKey: tokenData.SecretAccessKey,
      SessionToken: tokenData.SessionToken,
      ExpiredTime: expiredTime,
    };
    this.imageXTokenExpiry = expiredTime;
    return this.cachedImageXToken;
  }

  private async uploadImageBinaryInternal(file: Blob): Promise<string> {
    const token = await this.getImageXToken();

    // 1. Apply
    const applyUrl = `https://imagex.bytedanceapi.com/?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=${IMAGEX_SERVICE_ID}`;
    const applySign = await signAWS4({
      method: "GET",
      url: applyUrl,
      accessKeyId: token.AccessKeyId,
      secretAccessKey: token.SecretAccessKey,
      securityToken: token.SessionToken,
      region: "cn-north-1",
      service: "imagex",
    });
    const applyRes = await this.runtime.fetch(applyUrl, {
      headers: applySign.headers,
    });
    const applyData = (await applyRes.json()) as ImageXApplyUploadResponse;
    const addr = applyData.Result.UploadAddress;

    // 2. Upload to TOS
    const uploadUrl = `https://${addr.UploadHosts[0]}/${addr.StoreInfos[0].StoreUri}`;
    const arrayBuffer = await file.arrayBuffer();
    const crc32Value = crc32(new Uint8Array(arrayBuffer));
    await this.runtime.fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: addr.StoreInfos[0].Auth,
        "Content-Type": file.type || "application/octet-stream",
        "Content-CRC32": crc32Value,
      },
      body: file,
    });

    // 3. Commit
    const commitUrl = `https://imagex.bytedanceapi.com/?Action=CommitImageUpload&Version=2018-08-01&SessionKey=${encodeURIComponent(addr.SessionKey)}&ServiceId=${IMAGEX_SERVICE_ID}`;
    const commitSign = await signAWS4({
      method: "POST",
      url: commitUrl,
      accessKeyId: token.AccessKeyId,
      secretAccessKey: token.SecretAccessKey,
      securityToken: token.SessionToken,
      region: "cn-north-1",
      service: "imagex",
    });
    await this.runtime.fetch(commitUrl, {
      method: "POST",
      headers: { ...commitSign.headers, "Content-Length": "0" },
    });

    // 4. Get Final URL
    const getUrl = `https://api.juejin.cn/imagex/v2/get_img_url?aid=${IMAGEX_AID}&uuid=${this.uuid}&uri=${encodeURIComponent(addr.StoreInfos[0].StoreUri)}&img_type=private`;
    const finalRes = await this.runtime.fetch(getUrl, {
      method: "GET",
      credentials: "include",
    });
    const finalData = await finalRes.json();
    return finalData.data?.main_url || finalData.data?.backup_url || "";
  }

  async getCategories() {
    const response = await this.runtime.fetch(
      "https://api.juejin.cn/tag_api/v1/query_category_briefs",
      {
        method: "GET",
        credentials: "include",
      },
    );
    const data = await response.json();
    return (data.data || []).map((c: any) => ({
      id: c.category_id,
      name: c.category_name,
    }));
  }
}
