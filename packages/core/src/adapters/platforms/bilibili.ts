/**
 * B站适配器 - 适配新版编辑器 (new-edit) 与封面功能
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

const logger = createLogger("Bilibili");

interface BilibiliUserInfo {
  mid: number;
  uname: string;
  face: string;
  isLogin: boolean;
}

export class BilibiliAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: "bilibili",
    name: "哔哩哔哩",
    icon: "https://www.bilibili.com/favicon.ico",
    homepage: "https://member.bilibili.com/platform/upload/text",
    capabilities: ["article", "draft", "image_upload", "cover"],
  };

  readonly preprocessConfig = {
    outputFormat: "html" as const,
    removeLinks: true,
  };

  private userInfo: BilibiliUserInfo | null = null;
  private csrf: string = "";

  private readonly HEADER_RULES = [
    {
      urlFilter: "*://api.bilibili.com/*",
      headers: {
        Origin: "https://member.bilibili.com",
        Referer: "https://member.bilibili.com/",
      },
      resourceTypes: ["xmlhttprequest"],
    },
  ];

  async checkAuth(): Promise<AuthResult> {
    try {
      const res = await this.get<{
        code: number;
        data?: BilibiliUserInfo;
      }>("https://api.bilibili.com/x/web-interface/nav");

      if (res.code === 0 && res.data?.isLogin) {
        this.userInfo = res.data;
        if (this.runtime.getCookie) {
          this.csrf =
            (await this.runtime.getCookie(".bilibili.com", "bili_jct")) || "";
        }
        return {
          isAuthenticated: true,
          userId: String(res.data.mid),
          username: res.data.uname,
          avatar: res.data.face,
        };
      }
      return { isAuthenticated: false };
    } catch (error) {
      return { isAuthenticated: false, error: (error as Error).message };
    }
  }

  async publish(
    article: Article,
    options?: PublishOptions,
  ): Promise<SyncResult> {
    return this.withHeaderRules(this.HEADER_RULES, async () => {
      if (!this.userInfo) await this.checkAuth();
      if (!this.csrf) throw new Error("获取 CSRF token 失败");

      // 1. 处理正文图片
      let content = article.html || "";
      content = await this.processImages(
        content,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: ["hdslb.com", "bilibili.com"],
          onProgress: options?.onImageProgress,
        },
      );

      // 2. 处理封面图 (使用修正后的上传逻辑)
      let coverUrl: string = "";
      if (article.cover) {
        try {
          logger.info(`[Bilibili] 正在同步封面: ${article.cover}`);
          const uploadRes = await this.uploadImageByUrl(article.cover);
          coverUrl = uploadRes.url;
          logger.info(`[Bilibili] 封面同步成功: ${coverUrl}`);
        } catch (error) {
          logger.error(`[Bilibili] 封面同步失败:`, error);
        }
      }

      // 3. 构建新版草稿 Payload (JSON格式)
      const payload = {
        title: article.title,
        content: content,
        image_url: coverUrl, // 封面图
        origin_image_urls: coverUrl ? [coverUrl] : [],
        apply_cover: coverUrl ? 1 : 0, // 关键：开启自定义封面
        category: 1, // 默认生活区
        tid: 4, // 对应具体分区
        original: 1, // 1 原创, 0 转载
        tags: (article.tags || []).join(","),
        csrf: this.csrf,
      };

      // 4. 调用新版保存接口
      const response = await this.runtime.fetch(
        `https://api.bilibili.com/x/dynamic/feed/article/draft/add?csrf=${this.csrf}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      const res = await response.json();
      logger.debug("Draft response:", res);

      if (res.code !== 0 || !res.data?.article_id) {
        throw new Error(res.message || "保存草稿失败");
      }

      // 修正跳转链接为 new-edit
      const draftUrl = `https://member.bilibili.com/platform/upload/text/new-edit?aid=${res.data.article_id}`;

      return this.createResult(true, {
        postId: String(res.data.article_id),
        postUrl: draftUrl,
        draftOnly: true,
      });
    }).catch((error) =>
      this.createResult(false, {
        error: (error as Error).message,
      }),
    );
  }

  /**
   * 修正后的上传逻辑：解决 4100001 参数错误
   */
  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    if (!this.csrf) throw new Error("CSRF token 未获取");

    const imageResponse = await fetch(src);
    if (!imageResponse.ok) throw new Error("图片下载失败");
    const imageBlob = await imageResponse.blob();

    const formData = new FormData();
    // 关键修正：新版 upload_bfs 通常识别 'file_up' 或 'binary'
    // 这里使用你截图中对应的 upload_bfs 逻辑
    formData.append("file_up", imageBlob, "cover.jpg");
    formData.append("csrf", this.csrf);
    formData.append("busines", "article"); // 注意是 busines (单s)
    formData.append("category", "article");

    const uploadUrl = "https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs";
    const uploadResponse = await this.runtime.fetch(uploadUrl, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    const res = await uploadResponse.json();

    // 如果 file_up 仍然报错，尝试换成 'binary'
    if (res.code === 4100001) {
      logger.warn("尝试使用 binary 重新上传...");
      const retryData = new FormData();
      retryData.append("binary", imageBlob, "cover.jpg");
      retryData.append("csrf", this.csrf);
      retryData.append("category", "article");
      const retryRes = await this.runtime.fetch(uploadUrl, {
        method: "POST",
        credentials: "include",
        body: retryData,
      });
      const retryJson = await retryRes.json();
      if (retryJson.code === 0) return { url: retryJson.data.image_url };
    }

    if (res.code !== 0 || !res.data?.image_url) {
      throw new Error(res.message || "图片上传失败");
    }

    return {
      url: res.data.image_url,
      attrs: {
        size: String(res.data.img_size || ""),
      },
    };
  }
}
