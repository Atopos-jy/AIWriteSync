/**
 * 百家号适配器
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

const logger = createLogger("Baijiahao");

interface BaijiahaoUserInfo {
  userid: string;
  name: string;
  avatar: string;
}

export class BaijiahaoAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: "baijiahao",
    name: "百家号",
    icon: "https://www.baidu.com/favicon.ico",
    homepage: "https://baijiahao.baidu.com/",
    capabilities: ["article", "draft", "image_upload"],
  };

  /** 预处理配置: 百家号使用 HTML 格式 */
  readonly preprocessConfig = {
    outputFormat: "html" as const,
  };

  private userInfo: BaijiahaoUserInfo | null = null;
  private authToken: string = "";

  /** 百家号 API 需要的 Header 规则 */
  private readonly HEADER_RULES = [
    {
      urlFilter: "*://baijiahao.baidu.com/*",
      headers: {
        Origin: "https://baijiahao.baidu.com",
        Referer: "https://baijiahao.baidu.com/",
      },
      resourceTypes: ["xmlhttprequest"],
    },
  ];

  async checkAuth(): Promise<AuthResult> {
    try {
      const res = await this.get<{
        errno: number;
        errmsg: string;
        data?: { user: BaijiahaoUserInfo };
      }>(`https://baijiahao.baidu.com/builder/app/appinfo?_=${Date.now()}`);

      logger.debug("checkAuth response:", res);

      if (res.errmsg === "success" && res.data?.user) {
        this.userInfo = res.data.user;
        return {
          isAuthenticated: true,
          userId: res.data.user.userid,
          username: res.data.user.name,
          avatar: res.data.user.avatar,
        };
      }

      return { isAuthenticated: false };
    } catch (error) {
      logger.debug("checkAuth: not logged in -", error);
      return { isAuthenticated: false, error: (error as Error).message };
    }
  }

  private async fetchAuthToken(): Promise<string> {
    const response = await this.runtime.fetch(
      "https://baijiahao.baidu.com/builder/rc/edit",
      {
        credentials: "include",
      },
    );
    const html = await response.text();

    const match = html.match(
      /window\.__BJH__INIT__AUTH__\s*=\s*['"]([^'"]+)['"]/,
    );
    if (!match) {
      throw new Error("登录失效，请重新登录百家号");
    }

    const token = match[1];
    logger.debug("Auth token obtained");
    return token;
  }

  async publish(
    article: Article,
    options?: PublishOptions,
  ): Promise<SyncResult> {
    return this.withHeaderRules(this.HEADER_RULES, async () => {
      logger.info("Starting publish...");

      if (!this.userInfo) {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) {
          throw new Error("请先登录百家号");
        }
      }

      this.authToken = await this.fetchAuthToken();

      // Use pre-processed HTML content directly
      let content = article.html || "";

      content = await this.processImages(
        content,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: ["baijiahao.baidu.com", "bdstatic.com", "bcebos.com"],
          onProgress: options?.onImageProgress,
        },
      );

      // ==============================================
      // 🔥 全字段同步处理
      // ==============================================
      let finalContent = "";

      // 1. 标签处理：百家号不支持标签，在文前添加标签文本
      if (article.tags && article.tags.length > 0) {
        const tagsText = article.tags.map((tag) => `#${tag}`).join(" ");
        finalContent += "<p><strong>标签：</strong>" + tagsText + "</p>\n";
      }

      // 2. 摘要处理：百家号不支持摘要，在文前添加摘要文本
      if (article.summary) {
        finalContent +=
          "<p><strong>摘要：</strong>" + article.summary + "</p>\n\n";
      }

      // 3. 作者信息处理
      if (article.author) {
        finalContent +=
          "<p><strong>作者：" + article.author + "</strong></p>\n\n";
      }

      // 4. 正文内容
      finalContent += content;

      // 5. 版权声明处理
      finalContent += "\n\n";
      if (article.articleType === "original") {
        finalContent +=
          "<p><strong>原创声明：</strong>本文为原创内容，未经授权禁止转载。</p>";
      } else if (article.url) {
        finalContent +=
          '<p><strong>转载声明：</strong>本文转载自 <a href="' +
          article.url +
          '" target="_blank">' +
          article.url +
          "</a></p>";
      }

      // 封面上传处理
      let coverUrl = "";
      if (article.cover) {
        try {
          console.log(`[Baijiahao] 开始上传封面: ${article.cover}`);
          const uploadResult = await this.uploadImageByUrl(article.cover);
          coverUrl = uploadResult.url;
          console.log(`[Baijiahao] 封面上传成功: ${coverUrl}`);
        } catch (error) {
          console.error(`[Baijiahao] 封面上传失败:`, error);
        }
      }

      // 设置原创状态
      const originalStatus = article.articleType === "original" ? "1" : "0";

      const response = await this.runtime.fetch(
        "https://baijiahao.baidu.com/pcui/article/save?callback=bjhdraft",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            token: this.authToken,
          },
          body: new URLSearchParams({
            title: article.title,
            content: finalContent,
            feed_cat: article.category || "1",
            len: String(finalContent.length),
            activity_list: JSON.stringify([{ id: 408, is_checked: 0 }]),
            source_reprinted_allow:
              article.articleType === "original" ? "0" : "1",
            original_status: originalStatus,
            original_handler_status: "1",
            isBeautify: "false",
            subtitle: article.summary || "",
            bjhtopic_id: "",
            bjhtopic_info: "",
            type: "news",
            cover: coverUrl,
          }),
        },
      );

      const text = await response.text();
      const jsonStr = text.replace(/^bjhdraft\(/, "").replace(/\)$/, "");
      const res = JSON.parse(jsonStr) as {
        errno: number;
        errmsg: string;
        ret?: { article_id: string };
      };

      logger.debug("Save response:", res);

      if (res.errmsg !== "success" || !res.ret?.article_id) {
        throw new Error(res.errmsg || "保存草稿失败");
      }

      const postId = res.ret.article_id;
      const draftUrl = `https://baijiahao.baidu.com/builder/rc/edit?type=news&article_id=${postId}`;

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

  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    const imageResponse = await fetch(src);
    if (!imageResponse.ok) {
      throw new Error("图片下载失败: " + src);
    }
    const imageBlob = await imageResponse.blob();

    const formData = new FormData();
    formData.append("media", imageBlob, "image.jpg");
    formData.append("type", "image");
    formData.append("app_id", "1589639493090963");
    formData.append("is_waterlog", "1");
    formData.append("save_material", "1");
    formData.append("no_compress", "0");
    formData.append("is_events", "");
    formData.append("article_type", "news");

    const uploadUrl = "https://baijiahao.baidu.com/pcui/picture/uploadproxy";
    const uploadResponse = await this.runtime.fetch(uploadUrl, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    const res = (await uploadResponse.json()) as {
      errno: number;
      errmsg: string;
      ret?: { https_url: string };
    };

    logger.debug("Image upload response:", res);

    if (res.errmsg !== "success" || !res.ret?.https_url) {
      throw new Error(res.errmsg || "图片上传失败");
    }

    return {
      url: res.ret.https_url,
    };
  }
}
