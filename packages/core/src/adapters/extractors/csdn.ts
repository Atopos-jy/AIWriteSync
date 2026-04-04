import { BaseAdapter } from "../base";
import type {
  PlatformMeta,
  AuthResult,
  SyncResult,
  Article,
} from "../../types";

export interface ExtractResult {
  title: string;
  content: HTMLElement | null;
  excerpt?: string;
  leadingImage?: string;
  extractor: string;
}

export class CsdnExtractAdapter extends BaseAdapter {
  readonly meta: PlatformMeta = {
    id: "csdn-extract",
    name: "CSDN文章提取",
    icon: "https://csdnimg.cn/favicon.ico",
    homepage: "https://www.csdn.net",
    capabilities: [],
  };

  async match(): Promise<boolean> {
    const url = window.location.href;
    const hostname = window.location.hostname;

    const domainPattern = /csdn\.net/;
    if (!domainPattern.test(hostname)) return false;

    const articlePathPattern = /\/article\/|\/blog\//;
    if (!articlePathPattern.test(url)) return false;

    return true;
  }

  extract(): ExtractResult {
    const title = this.extractTitle();
    let contentEl = this.extractContentContainer();
    if (contentEl) {
      this.cleanContent(contentEl);
    }
    const leadingImage = this.extractLeadingImage();
    const excerpt = this.extractExcerpt(contentEl);

    return {
      title,
      content: contentEl,
      excerpt,
      leadingImage,
      extractor: "csdn-extract",
    };
  }

  private extractTitle(): string {
    const titleElements = [
      "#articleContentId",
      ".title-article",
      "h1.title-article",
      "title",
    ];

    for (const selector of titleElements) {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.textContent?.trim() || "";
        if (text) return text;
      }
    }

    return "";
  }

  private extractContentContainer(): HTMLElement | null {
    const contentSelectors = [
      "#article_content",
      "#content_views",
      ".markdown_views",
      ".blog-content-box",
    ];

    for (const selector of contentSelectors) {
      const element = document.querySelector(selector) as HTMLElement | null;
      if (element) {
        return element;
      }
    }

    return null;
  }

  private extractLeadingImage(): string | undefined {
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage) {
      const content = ogImage.getAttribute("content");
      if (content) return content;
    }

    const firstImage = document.querySelector(
      "#article_content img, #content_views img",
    );
    if (firstImage) {
      return (firstImage as HTMLImageElement).src || undefined;
    }

    return undefined;
  }

  private extractExcerpt(contentEl: HTMLElement | null): string | undefined {
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      const content = metaDescription.getAttribute("content");
      if (content) return content.trim();
    }

    if (contentEl) {
      const firstParagraph = contentEl.querySelector("p");
      if (firstParagraph) {
        const text = firstParagraph.textContent?.trim();
        if (text && text.length > 0) {
          return text.length > 100 ? text.substring(0, 100) + "..." : text;
        }
      }
    }

    return undefined;
  }

  private cleanContent(content: HTMLElement): void {
    // 使用基类提供的通用清理方法
    this.cleanInterferenceElements(content);

    // CSDN特有的清理选择器
    const csdnSpecificSelectors = [
      ".article-header-box",
      ".article-info-box",
      ".blog-tags-box",
      ".operating",
      ".bar-content",
      ".opt-box",
      ".pre-numbering",
      ".code-language",
      ".hljs-button",
      ".btn-code-notes",
      ".article-bar-top",
      ".article-tag",
      ".community-name",
      ".href-article-edit",
      ".href-article-edit-new",
      ".read-count-box",
      ".is-like",
      "#blog_detail_zk_collection",
      ".border-dian",
      ".time",
      ".read-count",
      ".article-type-text",
    ];

    csdnSpecificSelectors.forEach((selector) => {
      const elements = content.querySelectorAll(selector);
      elements.forEach((element) => {
        element.remove();
      });
    });
  }

  async checkAuth(): Promise<AuthResult> {
    return { isAuthenticated: true, userId: "", username: "" };
  }

  async publish(_article: Article): Promise<SyncResult> {
    throw new Error("Extract adapter does not support publish operation");
  }
}
