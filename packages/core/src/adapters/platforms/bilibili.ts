/**
 * B站适配器 - 增强版：全字段逻辑同步
 */
import { CodeAdapter, type ImageUploadResult } from "../code-adapter";
import type {
  Article,
  AuthResult,
  SyncResult,
  PlatformMeta,
} from "../../types";
import type { PublishOptions } from "../types";
import { ArticleProcessor } from "../article-processor";

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

  private userInfo: any = null;
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
      const res = await this.get<{ code: number; data?: any }>(
        "https://api.bilibili.com/x/web-interface/nav",
      );
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

      // 使用文章处理器处理内容
      const processed = ArticleProcessor.processHtmlContent(article, {
        supportsTags: true, // B站支持标签字段
        supportsSummary: false, // B站没有独立摘要展示位
        supportsCategory: false, // B站没有分类字段
        supportsCover: true, // B站支持封面
        supportsAuthor: false, // B站使用用户账号作为作者
      });

      // 拼接顺序：标签 -> 摘要 -> 正文 -> 版权
      let finalHtml = processed.content;

      // 4. 正文图片上传处理
      finalHtml = await this.processImages(
        finalHtml,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: ["hdslb.com", "bilibili.com"],
          onProgress: options?.onImageProgress,
        },
      );

      // 5. 封面上传
      let coverUrl: string = "";
      if (processed.cover) {
        try {
          const uploadRes = await this.uploadImageByUrl(processed.cover);
          coverUrl = uploadRes.url;
        } catch (error) {
          console.error(`[Bilibili] 封面上传失败:`, error);
        }
      }

      // 6. 调用接口保存
      const saveUrl = `https://api.bilibili.com/x/article/creative/draft/addupdate`;
      const response = await this.runtime.fetch(saveUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          title: processed.title,
          content: finalHtml,
          csrf: this.csrf,
          tid: "4", // 默认分区
          save: "0",
          pgc_id: "0",
          banner_url: coverUrl,
          tags: processed.tags.join(","), // 使用处理后的标签
          original: processed.articleType === "原创" ? "1" : "0",
        }).toString(),
      });

      const res = await response.json();
      const aid = res.data?.aid || res.data?.article_id;

      if (res.code !== 0 || !aid)
        throw new Error(res.message || "保存草稿失败");

      return this.createResult(true, {
        postId: String(aid),
        postUrl: `https://member.bilibili.com/platform/upload/text/new-edit?aid=${aid}`,
        draftOnly: true,
      });
    }).catch((error) =>
      this.createResult(false, { error: (error as Error).message }),
    );
  }

  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    if (!this.csrf) throw new Error("CSRF token 未获取");
    const imageResponse = await fetch(src);
    const imageBlob = await imageResponse.blob();
    const formData = new FormData();
    formData.append("binary", imageBlob, "image.jpg");
    formData.append("csrf", this.csrf);

    const uploadResponse = await this.runtime.fetch(
      "https://api.bilibili.com/x/article/creative/article/upcover",
      {
        method: "POST",
        credentials: "include",
        body: formData,
      },
    );

    const res = await uploadResponse.json();
    if (res.code !== 0 || !res.data?.url)
      throw new Error(res.message || "图片上传失败");
    return { url: res.data.url, attrs: { size: String(res.data.size || "") } };
  }
}
