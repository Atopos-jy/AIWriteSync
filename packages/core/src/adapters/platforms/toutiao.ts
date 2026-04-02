/**
 * 头条适配器（完整版，修复类型错误）
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

const logger = createLogger("Toutiao");

export class ToutiaoAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: "toutiao",
    name: "头条",
    icon: "https://sf1-ttcdn-tos.pstatp.com/obj/ttfe/pgcfe/sz/mp_logo.png",
    homepage: "https://mp.toutiao.com/profile_v4/graphic/publish",
    capabilities: ["article", "draft", "image_upload", "cover"],
  };

  readonly preprocessConfig = {
    outputFormat: "html" as const,
    removeLinks: true,
    removeEmptyImages: true,
    removeDataAttributes: true,
    flattenNestedBold: true,
    unwrapSingleChildSpans: true,
  };

  private readonly HEADER_RULES = [
    {
      urlFilter: "*://mp.toutiao.com/*",
      headers: {
        Origin: "https://mp.toutiao.com",
        Referer: "https://mp.toutiao.com/profile_v4/graphic/publish",
      },
      resourceTypes: ["xmlhttprequest"],
    },
  ];

  // ==================== 认证相关 ====================
  async checkAuth(): Promise<AuthResult> {
    try {
      const res = await this.get<{
        data?: {
          user?: { id: number; screen_name: string; https_avatar_url: string };
        };
      }>("https://mp.toutiao.com/mp/agw/media/get_media_info");

      if (res.data?.user?.id) {
        return {
          isAuthenticated: true,
          userId: String(res.data.user.id),
          username: res.data.user.screen_name,
          avatar: res.data.user.https_avatar_url,
        };
      }
      return { isAuthenticated: false };
    } catch (error) {
      return { isAuthenticated: false, error: (error as Error).message };
    }
  }

  private async getCsrfToken(): Promise<string> {
    const response = await this.runtime.fetch(
      "https://mp.toutiao.com/ttwid/check/",
      {
        method: "HEAD",
        credentials: "include",
        headers: {
          "x-secsdk-csrf-request": "1",
          "x-secsdk-csrf-version": "1.2.22",
        },
      },
    );
    return response.headers.get("x-ware-csrf-token") || "";
  }

  // ==================== 发布主流程 ====================
  async publish(
    article: Article,
    options?: PublishOptions,
  ): Promise<SyncResult> {
    return this.withHeaderRules(this.HEADER_RULES, async () => {
      // 1. 认证检查
      const auth = await this.checkAuth();
      if (!auth.isAuthenticated) {
        throw new Error("头条账号未登录，请先登录 mp.toutiao.com");
      }

      // 使用文章处理器处理内容（头条使用 HTML 格式）
      const processed = ArticleProcessor.processHtmlContent(article, {
        supportsTags: false, // 头条不支持标签字段，需拼接到内容中
        supportsSummary: false, // 头条不支持摘要字段
        supportsCategory: false, // 头条不支持分类字段
        supportsCover: true, // 头条支持封面
        supportsAuthor: false, // 头条不支持作者字段，需拼接到内容中
      });

      // 处理正文图片（上传后得到原图URL）
      let content = await this.processImages(
        processed.content,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: ["pstatp.com", "toutiao.com", "byteimg.com"],
          onProgress: options?.onImageProgress,
        },
      );

      content = content.replace(
        /<img\s+([^>]+)>/gi,
        '<div class="pgc-img"><img $1><p class="pgc-img-caption"></p></div>',
      );

      // 构建发布数据
      const extra = JSON.stringify({
        content_source: 100000000402,
        content_word_cnt: content.length,
        is_multi_title: 0,
        sub_titles: [],
        gd_ext: {
          entrance: "",
          from_page: "publisher_mp",
          enter_from: "PC",
          device_platform: "mp",
          is_message: 0,
        },
      });

      const titleId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

      // 获取 CSRF Token
      const csrfToken = await this.getCsrfToken();

      // 如果有封面，先上传封面图片
      let coverData = null;
      if (processed.cover) {
        console.log("[Toutiao] 上传封面图片:", processed.cover);
        const coverUploadResult = await this.uploadImageByUrl(processed.cover);
        console.log("[Toutiao] 封面上传成功:", coverUploadResult);
        coverData = {
          cover_url: coverUploadResult.coverUrl || coverUploadResult.url,
          image_url: coverUploadResult.url,
          image_uri: coverUploadResult.attrs?.image_uri || "",
          image_width: parseInt(
            String(coverUploadResult.attrs?.img_width) || "0",
          ),
          image_height: parseInt(
            String(coverUploadResult.attrs?.img_height) || "0",
          ),
        };
      }

      // 6. 通过 content script 执行发布流程
      const tabId = await this.ensureToutiaoTab();

      const result = await this.runtime.tabs?.executeScript<
        { success: boolean; data?: any; error?: string },
        [string, string, string, string, string, boolean, string]
      >(
        tabId,
        async (
          fetchCsrfToken: string,
          fetchContent: string,
          fetchTitle: string,
          fetchExtra: string,
          fetchTitleId: string,
          fetchDraftOnly: boolean,
          fetchCoverData: string,
        ) => {
          console.log("[ContentScript] Script started");
          console.log("[ContentScript] Parameters:", {
            csrfToken: fetchCsrfToken.substring(0, 20) + "...",
            contentLength: fetchContent.length,
            title: fetchTitle,
            hasCover: !!fetchCoverData,
            extraLength: fetchExtra.length,
            titleId: fetchTitleId,
            draftOnly: fetchDraftOnly,
          });
          try {
            console.log("[ContentScript] Start publish process");
            let pgcFeedCovers = "[]";
            const draftFormData: any = { coverType: 3 };

            // 如果有封面数据，直接构建封面对象
            const hasCover = fetchCoverData && fetchCoverData !== "{}";
            if (hasCover) {
              const coverData = JSON.parse(fetchCoverData);
              console.log("[ContentScript] Cover data:", coverData);

              // 封面尺寸校验
              if (coverData.image_width < 300 || coverData.image_height < 200) {
                throw new Error("封面尺寸过小，要求至少 300x200");
              }

              // 构建封面数据（符合头条要求的结构）
              const coverObject = {
                id: coverData.image_uri,
                url: coverData.cover_url,
                uri: coverData.image_uri,
                origin_uri: coverData.image_uri,
                ic_uri: coverData.image_uri,
                thumb_width: coverData.image_width,
                thumb_height: coverData.image_height,
              };
              console.log("[ContentScript] Cover object:", coverObject);
              pgcFeedCovers = JSON.stringify([coverObject]);
              console.log("[ContentScript] pgcFeedCovers:", pgcFeedCovers);
              draftFormData.coverType = 1;
              draftFormData.cover = [coverObject];
            }

            // 构建发布请求表单
            const publishFormData = new URLSearchParams();
            publishFormData.append("pgc_id", "0");
            publishFormData.append("source", "29");
            publishFormData.append("extra", fetchExtra);
            publishFormData.append("content", fetchContent);
            publishFormData.append("title", fetchTitle);
            publishFormData.append(
              "search_creation_info",
              JSON.stringify({
                searchTopOne: 0,
                abstract: "",
                clue_id: "",
              }),
            );
            publishFormData.append("title_id", fetchTitleId);
            publishFormData.append("mp_editor_stat", "{}");
            publishFormData.append("is_refute_rumor", "0");
            const saveValue = fetchDraftOnly === false ? "0" : "1";
            publishFormData.append("save", saveValue);
            publishFormData.append("timer_status", "0");
            publishFormData.append("timer_time", "");
            publishFormData.append("educluecard", "");
            publishFormData.append(
              "draft_form_data",
              JSON.stringify(draftFormData),
            );
            publishFormData.append("pgc_feed_covers", pgcFeedCovers);
            publishFormData.append("article_ad_type", "0");
            publishFormData.append("is_fans_article", "0");
            publishFormData.append("govern_forward", "0");
            publishFormData.append("praise", "0");
            publishFormData.append("disable_praise", "0");
            publishFormData.append("tree_plan_article", "0");
            publishFormData.append("activity_tag", "0");
            publishFormData.append("trends_writing_tag", "0");
            publishFormData.append("claim_exclusive", "0");

            // 发布文章
            const publishUrl =
              "https://mp.toutiao.com/mp/agw/article/publish?source=mp&type=article&aid=1231";
            console.log("[ContentScript] Publish URL:", publishUrl);
            console.log(
              "[ContentScript] Publish form data keys:",
              Array.from(publishFormData.keys()),
            );
            console.log(
              "[ContentScript] Publish pgcFeedCovers:",
              publishFormData.get("pgc_feed_covers"),
            );

            let publishResult: any;
            try {
              const publishResponse = await fetch(publishUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                credentials: "include",
                body: publishFormData.toString(),
              });

              console.log(
                "[ContentScript] Publish response status:",
                publishResponse.status,
              );
              const publishText = await publishResponse.text();
              console.log(
                "[ContentScript] Publish response text:",
                publishText,
              );
              publishResult = JSON.parse(publishText);
              console.log("[ContentScript] Publish result:", publishResult);
            } catch (publishError) {
              console.error("[ContentScript] Publish error:", publishError);
              throw new Error(
                `发布请求失败: ${(publishError as Error).message}`,
              );
            }

            return { success: true, data: publishResult };
          } catch (error) {
            console.error("[ContentScript] Error:", error);
            return { success: false, error: (error as Error).message };
          }
        },
        [
          csrfToken,
          content,
          processed.title,
          extra,
          titleId,
          options?.draftOnly ?? true,
          JSON.stringify(coverData || {}),
        ],
      );

      console.log("[Toutiao] executeScript result:", result);
      if (!result) {
        throw new Error(
          "executeScript returned undefined – script may have failed to run",
        );
      }
      if (!result.success) {
        throw new Error(result.error || "发布请求失败");
      }

      const res = result.data;

      if (res.err_no !== 0 || !res.data?.pgc_id) {
        throw new Error(res.message || `发布失败，错误码: ${res.err_no}`);
      }

      const draftId = res.data.pgc_id;
      const draftUrl = `https://mp.toutiao.com/profile_v4/graphic/publish?pgc_id=${draftId}`;

      return this.createResult(true, {
        postId: draftId,
        postUrl: draftUrl,
        draftOnly: options?.draftOnly ?? true,
      });
    }).catch((error) =>
      this.createResult(false, { error: (error as Error).message }),
    );
  }

  // ==================== 页面 Tab 管理 ====================
  private async ensureToutiaoTab(): Promise<number> {
    if (!this.runtime.tabs) {
      throw new Error("头条发布需要浏览器 tabs API 支持");
    }

    const tabs = await this.runtime.tabs.query("https://mp.toutiao.com/*");
    if (tabs.length > 0 && tabs[0].id) {
      return tabs[0].id;
    }

    logger.info("No existing tab found, creating new one...");
    const tab = await this.runtime.tabs.create(
      "https://mp.toutiao.com/profile_v4/graphic/publish",
      false,
    );
    await this.runtime.tabs.waitForLoad(tab.id, 30000);
    logger.info("New tab created and loaded:", tab.id);
    return tab.id;
  }

  // ==================== 图片上传 ====================
  protected async uploadImageByUrl(
    src: string,
  ): Promise<ImageUploadResult & { coverUrl?: string; originalUrl?: string }> {
    console.log("[Toutiao] 开始上传图片:", src);

    // 1. 下载图片
    const imageResponse = await this.runtime.fetch(src);
    if (!imageResponse.ok) {
      throw new Error(`图片下载失败: ${src} (状态码: ${imageResponse.status})`);
    }
    const imageBlob = await imageResponse.blob();
    console.log("[Toutiao] 图片下载成功，大小:", imageBlob.size, "字节");

    // 2. 获取 CSRF Token
    const csrfToken = await this.getCsrfToken();

    // 3. 通过页面上下文上传
    return this.uploadImageViaContentScript(imageBlob, csrfToken);
  }

  private async uploadImageViaContentScript(
    imageBlob: Blob,
    csrfToken: string,
  ): Promise<ImageUploadResult & { coverUrl?: string; originalUrl?: string }> {
    const tabId = await this.ensureToutiaoTab();
    console.log("[Toutiao] 使用标签页:", tabId, "在 MAIN world 中上传图片");

    // 将 Blob 转换为 base64（用于传递）
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        if (!result) {
          reject(new Error("FileReader 读取失败"));
          return;
        }
        const base64Data = result.split(",")[1];
        if (!base64Data) {
          reject(new Error("无法提取 base64 数据"));
          return;
        }
        console.log(
          "[Toutiao] 图片转换为 base64 成功，长度:",
          base64Data.length,
        );
        resolve(base64Data);
      };
      reader.onerror = () => reject(new Error("FileReader 错误"));
      reader.readAsDataURL(imageBlob);
    });

    // 在页面上下文中执行上传（修正泛型）
    const result = await this.runtime.tabs?.executeScript<
      { success: boolean; data?: any; error?: string },
      [string, string]
    >(
      tabId,
      async (uploadCsrfToken: string, imageBase64: string) => {
        try {
          const uploadUrl =
            "https://mp.toutiao.com/spice/image?upload_source=20020003&aid=1231&device_platform=web&need_cover_url=1";
          console.log("[Toutiao] 开始上传图片，URL:", uploadUrl);

          // base64 转 Blob
          const byteCharacters = atob(imageBase64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: "image/jpeg" });

          const formData = new FormData();
          formData.append("image", blob, "image.jpg");

          const response = await fetch(uploadUrl, {
            method: "POST",
            headers: {
              "x-secsdk-csrf-token": uploadCsrfToken,
            },
            credentials: "include",
            body: formData,
          });

          const text = await response.text();
          console.log("[Toutiao] 上传响应内容:", text);
          try {
            const data = JSON.parse(text);
            return { success: true, data };
          } catch {
            return {
              success: false,
              error: `响应解析失败: ${text.substring(0, 100)}`,
            };
          }
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      [csrfToken, base64],
    );

    if (!result || !result.success) {
      throw new Error(result?.error || "图片上传请求失败");
    }

    const res = result.data;
    if (res.code !== 0 || !res.data) {
      throw new Error(res.message || "图片上传失败");
    }

    // 提取关键数据，确保类型安全
    const imageUri = res.data.image_uri;
    const imageUrl = res.data.image_url; // 原图 URL（~tplv-obj.image）
    const coverUrl = res.data.cover_url; // 封面专用 URL（~tplv-tt-cover-v2.image）
    const width = res.data.image_width;
    const height = res.data.image_height;

    console.log("[Toutiao] 图片上传成功，原图 URL:", imageUrl);
    console.log("[Toutiao] 封面 URL:", coverUrl);

    // 返回符合 ImageUploadResult 的结构，并附加 coverUrl / originalUrl
    return {
      url: imageUrl, // 供正文使用的原图 URL
      originalUrl: imageUrl,
      coverUrl: coverUrl,
      attrs: {
        class: "",
        "ic-uri": "",
        image_type: "image/jpeg",
        mime_type: "image/jpeg",
        image_uri: imageUri,
        img_width: String(width),
        img_height: String(height),
      },
    };
  }
}
