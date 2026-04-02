/**
 * 一点号适配器
 * https://mp.yidianzixun.com
 */
import { CodeAdapter, ImageUploadResult } from "../code-adapter";
import type {
  Article,
  AuthResult,
  SyncResult,
  PlatformMeta,
} from "../../types";
import { createLogger } from "../../lib/logger";
import { ArticleProcessor } from "../article-processor";

const logger = createLogger("Yidian");

export class YidianAdapter extends CodeAdapter {
  meta: PlatformMeta = {
    id: "yidian",
    name: "一点号",
    icon: "https://www.yidianzixun.com/favicon.ico",
    homepage: "https://mp.yidianzixun.com",
    capabilities: ["article", "draft", "image_upload"],
  };

  /** 预处理配置: 一点号使用 HTML 格式 */
  readonly preprocessConfig = {
    outputFormat: "html" as const,
    removeLinks: true,
  };

  /**
   * 检查登录状态
   */
  async checkAuth(): Promise<AuthResult> {
    try {
      const response = await this.runtime.fetch("https://mp.yidianzixun.com", {
        credentials: "include",
      });
      const html = await response.text();

      // 解析页面中的用户数据
      const match = html.match(/<script id="__val_"[^>]*>([\s\S]*?)<\/script>/);
      if (!match) {
        return { isAuthenticated: false, error: "未找到用户数据" };
      }

      const code = match[1];
      // 使用 Function 解析 window.mpuser
      const userMatch = code.match(/window\.mpuser\s*=\s*(\{[\s\S]*?\});/);
      if (!userMatch) {
        return { isAuthenticated: false, error: "未登录" };
      }

      try {
        const mpuser = JSON.parse(userMatch[1]);
        if (!mpuser.id) {
          return { isAuthenticated: false, error: "未登录" };
        }

        return {
          isAuthenticated: true,
          userId: mpuser.id,
          username: mpuser.media_name,
          avatar: mpuser.media_pic,
        };
      } catch {
        return { isAuthenticated: false, error: "解析用户数据失败" };
      }
    } catch (error) {
      return { isAuthenticated: false, error: (error as Error).message };
    }
  }

  /**
   * 上传图片 (URL 方式)
   */
  async uploadImageByUrl(url: string): Promise<ImageUploadResult> {
    // 一点号支持通过 URL 上传图片
    const apiUrl = `https://mp.yidianzixun.com/api/getImageFromUrl?src=${encodeURIComponent(url)}`;

    const response = await this.runtime.fetch(apiUrl, {
      credentials: "include",
    });
    const res = await response.json();

    if (res.status !== "success") {
      throw new Error(`图片上传失败: ${url}`);
    }

    logger.debug(`Image uploaded: ${res.inner_addr}`);
    return { url: res.inner_addr };
  }

  /**
   * 发布文章
   */
  async publish(article: Article): Promise<SyncResult> {
    const now = Date.now();
    try {
      // 使用文章处理器处理内容（一点号使用 HTML 格式）
      const processed = ArticleProcessor.processHtmlContent(article, {
        supportsTags: true, // 一点号支持标签字段
        supportsSummary: true, // 一点号支持摘要字段
        supportsCategory: true, // 一点号支持分类字段
        supportsCover: true, // 一点号支持封面
        supportsAuthor: false, // 一点号不支持作者字段
      });

      // Process images
      let content = await this.processImages(processed.content, (src) =>
        this.uploadImageByUrl(src),
      );

      // 处理封面图
      let covers = "[]";
      if (processed.cover) {
        try {
          const coverUploadResult = await this.uploadImageByUrl(
            processed.cover,
          );
          covers = JSON.stringify([coverUploadResult.url]);
        } catch (error) {
          logger.error("Failed to upload cover image:", error);
        }
      }

      // 3. 发布到一点号
      const response = await this.runtime.fetch(
        "https://mp.yidianzixun.com/model/Article",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            title: processed.title,
            cate: processed.category || "",
            cateB: "",
            coverType: processed.cover ? "custom" : "default",
            covers: covers,
            content: content,
            hasSubTitle: processed.summary ? "1" : "0",
            subTitle: processed.summary || "",
            original: processed.articleType === "original" ? "1" : "0",
            reward: "0",
            videos: "[]",
            audios: "[]",
            votes: JSON.stringify({
              vote_id: "",
              vote_options: [],
              vote_end_time: "",
              vote_title: "",
              vote_type: 1,
              isAdded: false,
            }),
            images: "[]",
            goods: "[]",
            is_mobile: "0",
            status: "0",
            import_url: article.url || "",
            import_hash: "",
            image_urls: "{}",
            minTimingHour: "3",
            maxTimingDay: "7",
            tags: JSON.stringify(processed.tags || []),
            isPubed: "false",
            lastSaveTime: "",
            dirty: "false",
            editorType: "articleEditor",
            activity_id: "0",
            join_activity: "0",
            notSaveToStore: "true",
          }),
        },
      );

      const res = await response.json();

      if (!res.id) {
        throw new Error("同步错误: " + JSON.stringify(res));
      }

      return {
        platform: this.meta.id,
        success: true,
        postId: res.id,
        postUrl: `https://mp.yidianzixun.com/#/Writing/${res.id}`,
        draftOnly: true,
        timestamp: now,
      };
    } catch (error) {
      return {
        platform: this.meta.id,
        success: false,
        error: (error as Error).message,
        timestamp: now,
      };
    }
  }
}
