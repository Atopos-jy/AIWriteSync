import { BaseAdapter } from "../base";
import type {
  PlatformMeta,
  AuthResult,
  SyncResult,
  Article,
} from "../../types";

/**
 * 掘金平台提取器
 * 用于从掘金文章页面提取文章信息
 */
export class JuejinExtractor extends BaseAdapter {
  readonly meta: PlatformMeta = {
    id: "juejin",
    name: "掘金",
    icon: "https://lf3-static.bytednsdoc.com/obj/eden-cn/phizvffoeh7oejgbpu/web-common/svg/icon-brand-juejin.svg",
    homepage: "https://juejin.cn",
    capabilities: ["article"],
  };

  /**
   * 检查当前页面是否为掘金文章页面
   */
  async match(): Promise<boolean> {
    try {
      // 检查URL是否匹配掘金文章页面
      const url = window.location.href;
      const articleRegex = /https:\/\/juejin\.cn\/post\/\d+/;

      if (!articleRegex.test(url)) {
        return false;
      }

      // 检查页面是否包含文章结构
      const articleElement = document.querySelector("article[data-entry-id]");
      return articleElement !== null;
    } catch (error) {
      console.error("[JuejinExtractor] Match check error:", error);
      return false;
    }
  }

  /**
   * 提取文章信息
   */
  async extractArticle(): Promise<Article | null> {
    try {
      // 检查页面是否为掘金文章页面
      const isMatch = await this.match();
      if (!isMatch) {
        return null;
      }

      // 提取标题
      const titleElement = document.querySelector(".article-title");
      const title = titleElement?.textContent?.trim() || "";

      if (!title) {
        return null;
      }

      // 提取作者
      const authorElement = document.querySelector(".author-name .name");
      const author = authorElement?.textContent?.trim() || "";

      // 提取发布日期
      const publishDateElement = document.querySelector(".meta-box .time");
      const publishDate = publishDateElement?.textContent?.trim() || "";

      // 提取文章内容
      const contentElement = document.getElementById("article-root");
      if (!contentElement) {
        return null;
      }

      // 创建内容的深拷贝，避免修改原页面
      const contentClone = contentElement.cloneNode(true) as HTMLElement;

      // 清理干扰元素
      this.cleanInterferenceElements(contentClone);

      // 提取HTML内容
      const html = contentClone.innerHTML;

      // 注意：Markdown转换通常由content script处理
      // 这里暂时返回空字符串，等待后续转换
      const markdown = "";

      // 提取标签
      const keywordsMeta = document.querySelector('meta[itemprop="keywords"]');
      const tags =
        keywordsMeta
          ?.getAttribute("content")
          ?.split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0) || [];

      // 提取封面图
      const imageMeta = document.querySelector('meta[itemprop="image"]');
      const cover = imageMeta?.getAttribute("content") || "";

      return {
        title,
        markdown,
        html,
        author,
        tags,
        publishDate,
        cover,
        url: window.location.href,
        source: {
          url: window.location.href,
          platform: "juejin",
        },
      };
    } catch (error) {
      console.error("[JuejinExtractor] Extract article error:", error);
      return null;
    }
  }

  /**
   * 检查认证状态（掘金提取器不需要认证）
   */
  async checkAuth(): Promise<AuthResult> {
    return {
      isAuthenticated: true,
    };
  }

  /**
   * 发布文章（提取器不需要实现发布功能）
   */
  async publish(_article: Article): Promise<SyncResult> {
    return this.createResult(false, {
      error: "JuejinExtractor is read-only and does not support publishing",
    });
  }

  /**
   * 清理掘金特定的干扰元素
   */
  protected cleanInterferenceElements(root: HTMLElement): void {
    // 调用基类的通用清理方法
    super.cleanInterferenceElements(root);

    // 掘金特定的清理
    const juejinSpecificSelectors = [
      ".author-info-block",
      ".follow-button",
      ".article-viewer",
      ".markdown-body",
      ".article",
      ".main",
    ];

    for (const selector of juejinSpecificSelectors) {
      try {
        root.querySelectorAll(selector).forEach((el) => el.remove());
      } catch (e) {
        console.error("[JuejinExtractor] Clean interference error:", e);
      }
    }

    // 清理样式标签
    root.querySelectorAll("style").forEach((style) => style.remove());

    // 清理空的容器
    const containers = root.querySelectorAll("div, section, article");
    containers.forEach((container) => {
      if (container.textContent?.trim() === "") {
        container.remove();
      }
    });
  }
}
