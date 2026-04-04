import { BaseAdapter } from "../base";
import type {
  PlatformMeta,
  AuthResult,
  SyncResult,
  Article,
} from "../../types";

/**
 * 百家号文章提取结果接口
 */
export interface ExtractResult {
  /** 文章标题 */
  title: string;
  /** 文章正文元素 */
  content: HTMLElement | null;
  /** 文章摘要（可选） */
  excerpt?: string;
  /** 封面图片（可选） */
  leadingImage?: string;
  /** 提取器标识 */
  extractor: string;
}

/**
 * 百家号文章提取专用适配器
 * 用于从百家号文章页提取标题、正文、封面、摘要，并自动清理推荐、广告、侧边栏等干扰元素
 */
export class BaijiahaoExtractAdapter extends BaseAdapter {
  /** 平台元信息 */
  readonly meta: PlatformMeta = {
    id: "baijiahao-extract",
    name: "百家号文章提取",
    icon: "https://www.baidu.com/favicon.ico",
    homepage: "https://baijiahao.baidu.com",
    capabilities: [],
  };

  /**
   * 匹配当前页面是否属于百家号文章页
   */
  async match(): Promise<boolean> {
    const url = window.location.href;
    const hostname = window.location.hostname;

    // 1. 域名匹配
    const domainPattern = /baijiahao\.baidu\.com/;
    if (!domainPattern.test(hostname)) return false;

    // 2. 路径匹配：文章页
    const articlePathPattern = /\/s\//;
    if (!articlePathPattern.test(url)) return false;

    return true;
  }

  /**
   * 提取文章内容
   */
  extract(): ExtractResult {
    // 提取标题
    const title = this.extractTitle();

    // 提取正文
    let contentElement = this.extractContentContainer();
    if (contentElement) {
      this.cleanContent(contentElement);
    } else {
      contentElement = this.fallbackFindContentContainer();
    }

    // 提取封面图片
    const leadingImage = this.extractLeadingImage();

    // 提取摘要
    const excerpt = this.extractExcerpt(contentElement);

    return {
      title,
      content: contentElement,
      excerpt,
      leadingImage,
      extractor: this.meta.id,
    };
  }

  /**
   * 提取标题
   */
  private extractTitle(): string {
    const selectors = [
      ".article-title",
      "h1.title",
      "h1",
      ".title",
      ".article-header h1",
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element?.textContent?.trim()) {
        return element.textContent.trim();
      }
    }

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle?.getAttribute("content")?.trim()) {
      return ogTitle.getAttribute("content")!.trim();
    }

    let docTitle = document.title;
    if (docTitle) {
      docTitle = docTitle.replace(/\s*[-|]\s*(百家号|百度).*$/i, "").trim();
      if (docTitle) return docTitle;
    }

    return "无标题";
  }

  /**
   * 提取正文容器
   */
  private extractContentContainer(): HTMLElement | null {
    const selectors = [
      ".article-content",
      ".article-body",
      ".content",
      ".article-main",
      "article",
      ".article-detail",
      ".article-box",
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector) as HTMLElement | null;
      if (element && element.innerText.trim().length > 200) {
        return element;
      }
    }

    return null;
  }

  /**
   * 备选方案查找正文容器
   */
  private fallbackFindContentContainer(): HTMLElement | null {
    const cloneBody = document.body.cloneNode(true) as HTMLElement;
    this.cleanContent(cloneBody);
    if (cloneBody.innerText.trim().length > 300) {
      const wrapper = document.createElement("div");
      wrapper.className = "fallback-content";
      wrapper.appendChild(cloneBody);
      return wrapper;
    }
    return null;
  }

  /**
   * 提取封面图片
   */
  private extractLeadingImage(): string | undefined {
    // 1. Open Graph 图片
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage?.getAttribute("content")?.startsWith("http")) {
      return ogImage.getAttribute("content")!;
    }

    // 2. 文章封面图片
    const coverSelectors = [
      ".article-cover img",
      ".cover-img img",
      ".article-header img",
      ".article-banner img",
      ".banner img",
    ];

    for (const selector of coverSelectors) {
      const img = document.querySelector(selector) as HTMLImageElement;
      if (img) {
        const src =
          img.getAttribute("src") ||
          img.getAttribute("data-src") ||
          img.getAttribute("data-original");
        if (src?.startsWith("http")) return src;
      }
    }

    // 3. 从正文中取第一张大图
    const contentContainer = this.extractContentContainer();
    if (contentContainer) {
      const imgs = contentContainer.querySelectorAll("img");
      for (const img of imgs) {
        const src =
          img.getAttribute("src") ||
          img.getAttribute("data-src") ||
          img.getAttribute("data-original");
        if (src?.startsWith("http")) {
          const width = img.width || parseInt(img.getAttribute("width") || "0");
          const height =
            img.height || parseInt(img.getAttribute("height") || "0");
          if (width >= 400 || height >= 300) return src;
        }
      }
    }

    return undefined;
  }

  /**
   * 提取摘要
   */
  private extractExcerpt(contentEl: HTMLElement | null): string | undefined {
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc?.getAttribute("content")?.trim()) {
      return metaDesc.getAttribute("content")!.trim();
    }

    const subtitle = document.querySelector(
      ".article-subtitle, .subtitle, .summary",
    );
    if (subtitle?.textContent?.trim()) {
      return subtitle.textContent.trim();
    }

    if (contentEl) {
      const text = contentEl.innerText.trim();
      if (text.length > 0) {
        return text.slice(0, 200) + (text.length > 200 ? "…" : "");
      }
    }

    return undefined;
  }

  /**
   * 清理内容中的干扰元素
   */
  private cleanContent(root: HTMLElement): void {
    // 使用基类提供的通用清理方法
    this.cleanInterferenceElements(root);

    // 百家号特有的清理选择器
    const baijiahaoSpecificSelectors = [
      ".article-append",
      ".article-footer-info",
      ".article-bottom",
      ".article-source",
      ".article-author-info",
      ".article-related",
      ".article-recommend",
      ".article-comment",
      ".article-share",
      ".article-vote",
      ".article-collect",
      ".article-report",
      ".article-toolbar",
      ".article-action",
      ".article-stat",
      ".article-tag",
      ".article-category",
      ".article-channel",
      ".article-label",
      ".article-mark",
      ".article-notice",
      ".article-warning",
      ".article-tip",
      ".article-hint",
      ".article-help",
      ".article-guide",
      ".article-navigator",
      ".article-pagination",
      ".article-recommendation",
      ".article-similar",
      ".article-related",
      ".article-hot",
      ".article-new",
      ".article-trend",
      ".article-rank",
      ".article-list",
      ".article-group",
      ".article-column",
      ".article-section",
      ".article-block",
      ".article-box",
      ".article-container",
      ".article-wrapper",
      ".article-content-wrap",
      ".article-content-container",
      ".article-content-box",
      ".article-body-wrap",
      ".article-body-container",
      ".article-body-box",
      ".article-main-wrap",
      ".article-main-container",
      ".article-main-box",
      ".article-detail-wrap",
      ".article-detail-container",
      ".article-detail-box",
    ];

    for (const selector of baijiahaoSpecificSelectors) {
      try {
        root.querySelectorAll(selector).forEach((el) => el.remove());
      } catch (e) {}
    }
  }

  async checkAuth(): Promise<AuthResult> {
    return { isAuthenticated: true, userId: "", username: "" };
  }

  async publish(_article: Article): Promise<SyncResult> {
    throw new Error("Extract adapter does not support publish operation");
  }
}
