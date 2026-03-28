/**
 * B站适配器 - 兼容新版编辑器的稳定版
 */
import { CodeAdapter, type ImageUploadResult } from "../code-adapter";
import type {
  Article,
  AuthResult,
  SyncResult,
  PlatformMeta,
} from "../../types";
import type { PublishOptions } from "../types";

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

      // 2. 上传封面 (获取 Bilibili 域名的 URL)
      let coverUrl: string = "";
      if (article.cover) {
        try {
          const uploadRes = await this.uploadImageByUrl(article.cover);
          coverUrl = uploadRes.url;
        } catch (error) {
          console.error(`[Bilibili] 封面上传失败:`, error);
        }
      }

      // 3. 使用兼容性最好的接口保存 (绕过 w_rid 校验)
      // 这里的逻辑是：通过旧接口存入数据，通过跳转 new-edit 强制唤起新版前端渲染
      const saveUrl = `https://api.bilibili.com/x/article/creative/draft/addupdate`;

      const response = await this.runtime.fetch(saveUrl, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          title: article.title,
          content: content,
          csrf: this.csrf,
          tid: "4", // 默认生活区
          save: "0", // 非直接发布
          pgc_id: "0",
          banner_url: coverUrl, // 旧接口封面字段
          image_url: coverUrl, // 冗余字段，增加新版编辑器识别率
          origin_image_urls: coverUrl ? JSON.stringify([coverUrl]) : "",
        }).toString(),
      });

      const res = await response.json();
      const aid = res.data?.aid || res.data?.article_id;

      if (res.code !== 0 || !aid) {
        throw new Error(res.message || "保存草稿失败");
      }

      // 4. 关键：强制返回新版编辑器的链接，让 UI 自动处理
      const draftUrl = `https://member.bilibili.com/platform/upload/text/new-edit?aid=${aid}`;

      return this.createResult(true, {
        postId: String(aid),
        postUrl: draftUrl,
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

    // 使用支持度最高的上传接口
    const uploadUrl =
      "https://api.bilibili.com/x/article/creative/article/upcover";
    const uploadResponse = await this.runtime.fetch(uploadUrl, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    const res = await uploadResponse.json();
    if (res.code !== 0 || !res.data?.url)
      throw new Error(res.message || "图片上传失败");

    return {
      url: res.data.url,
      attrs: { size: String(res.data.size || "") },
    };
  }
}
