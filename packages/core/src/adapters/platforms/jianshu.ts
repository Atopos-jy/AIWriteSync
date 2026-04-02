/**
 * 简书适配器 - 全字段同步规则增强版
 * 修复了微信图片防盗链导致的“未经允许不可引用”问题
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

const logger = createLogger("Jianshu");

export class JianshuAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: "jianshu",
    name: "简书",
    icon: "https://www.jianshu.com/favicon.ico",
    homepage: "https://www.jianshu.com",
    // 标记平台具备的能力
    capabilities: ["article", "draft", "image_upload", "categories", "cover"],
  };

  readonly preprocessConfig = {
    outputFormat: "html" as const,
  };

  private csrfToken: string = "";

  /**
   * 更新并获取 CSRF Token，防止 PUT 请求返回 404 (重定向至 sign_in)
   */
  private async refreshTokens() {
    if (this.runtime.getCookie) {
      this.csrfToken =
        (await this.runtime.getCookie(".jianshu.com", "X-CSRF-Token")) || "";
      logger.debug("[Jianshu] Refreshed CSRF Token:", this.csrfToken);
    }
  }

  async checkAuth(): Promise<AuthResult> {
    try {
      const response = await this.runtime.fetch(
        "https://www.jianshu.com/settings/basic.json",
        { method: "GET", credentials: "include" },
      );
      const data = await response.json();
      if (data.data?.nickname) {
        await this.refreshTokens();
        return {
          isAuthenticated: true,
          username: data.data.nickname,
          avatar: data.data.avatar,
        };
      }
      return { isAuthenticated: false };
    } catch (error) {
      return { isAuthenticated: false, error: (error as Error).message };
    }
  }

  /**
   * 核心发布逻辑：严格执行全字段拼接规则
   */
  async publish(
    article: Article,
    options?: PublishOptions,
  ): Promise<SyncResult> {
    try {
      logger.info("[Jianshu] 开始同步流程，执行全字段规则");
      await this.refreshTokens();

      // 1. 使用文章处理器处理内容（简书不支持标签和摘要字段，需拼接到内容中）
      const processed = ArticleProcessor.processHtmlContent(article, {
        supportsTags: false, // 简书不支持标签字段
        supportsSummary: false, // 简书不支持摘要字段
        supportsCategory: true, // 简书支持分类
        supportsCover: true, // 简书支持封面
        supportsAuthor: false, // 简书使用账号作者
      });

      // 2. 分类 (Category) 处理：寻找匹配的文集
      const notebooksRes = await this.runtime.fetch(
        "https://www.jianshu.com/author/notebooks",
        {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json",
            Referer: "https://www.jianshu.com/writer",
          },
        },
      );
      const notebooks = await notebooksRes.json();
      // 如果目标平台支持分类则同步，简书对应 Notebook
      const targetNotebook =
        notebooks.find((n: any) => n.name === processed.category) ||
        notebooks[0];
      const notebookId = targetNotebook.id;

      // 3. 创建初始草稿 ID
      const createRes = await this.runtime.fetch(
        "https://www.jianshu.com/author/notes",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            at_bottom: false,
            notebook_id: notebookId,
            title: processed.title,
          }),
        },
      );
      const createData = await createRes.json();
      const draftId = createData.id;
      if (!draftId) throw new Error("创建简书草稿失败");

      // 4. 封面图处理（使用处理后的封面）
      let coverUrl = "";
      if (processed.cover) {
        try {
          const res = await this.uploadImageByUrl(processed.cover);
          coverUrl = res.url;
        } catch (e) {
          logger.warn("[Jianshu] 封面上传失败，跳过封面设置", e);
        }
      }

      // 5. 处理图片转存
      let finalContent = processed.content;

      finalContent = await this.processImages(
        finalContent,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: ["jianshu.com", "upload-images.jianshu.io"],
          onProgress: options?.onImageProgress,
        },
      );

      // 6. 最终 PUT 更新草稿
      const updateRes = await this.runtime.fetch(
        `https://www.jianshu.com/author/notes/${draftId}`,
        {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-CSRF-Token": this.csrfToken, // 解决 404/重定向的关键
            Referer: "https://www.jianshu.com/writer",
          },
          body: JSON.stringify({
            title: processed.title,
            content: finalContent,
            autosave_control: 1,
            image_url: coverUrl || undefined, // 封面图同步
          }),
        },
      );

      if (!updateRes.ok) throw new Error(`更新草稿失败: ${updateRes.status}`);

      return this.createResult(true, {
        postId: String(draftId),
        postUrl: `https://www.jianshu.com/writer#/notebooks/${notebookId}/notes/${draftId}`,
        draftOnly: true,
      });
    } catch (error) {
      logger.error("[Jianshu] 同步异常:", error);
      return this.createResult(false, { error: (error as Error).message });
    }
  }

  /**
   * 破解防盗链的图片上传逻辑
   */
  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    try {
      // Step A: 下载原图 (绕过微信防盗链)
      const imgRes = await this.runtime.fetch(src, {
        referrerPolicy: "no-referrer",
        headers: { Referer: "" },
      });
      const blob = await imgRes.blob();

      // Step B: 获取 Token 和 Key
      // 简书要求带上文件名，我们固定一个文件名以获取 Token
      const tokenRes = await this.runtime.fetch(
        `https://www.jianshu.com/upload_images/token.json?filename=sync_${Date.now()}.jpg`,
        { credentials: "include" },
      );
      const { token, key } = await tokenRes.json();

      // Step C: 构造符合七牛云规范的 FormData
      // 注意：七牛云对字段顺序有要求，key 必须在 file 之前
      const fd = new FormData();
      fd.append("token", token); // 抓包显示的 token
      fd.append("key", key); // 抓包显示的 key
      fd.append("file", blob, key.split("/").pop()); // 真正的文件对象

      // Step D: 上传到七牛云接口
      const uploadRes = await this.runtime.fetch("https://upload.qiniup.com/", {
        method: "POST",
        body: fd,
      });

      const uploadData = await uploadRes.json();
      // 返回抓包中看到的最终 URL
      return {
        url:
          uploadData.url ||
          `https://upload-images.jianshu.io/${uploadData.key}`,
      };
    } catch (error) {
      logger.error("[Jianshu] 图片转存彻底失败:", error);
      return { url: src };
    }
  }
}
