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

export class BilibiliExtractAdapter extends BaseAdapter {
  readonly meta: PlatformMeta = {
    id: "bilibili-extract",
    name: "B站文章提取",
    icon: "https://www.bilibili.com/favicon.ico",
    homepage: "https://www.bilibili.com",
    capabilities: [],
  };

  async match(): Promise<boolean> {
    const url = window.location.href;
    const hostname = window.location.hostname;

    const domainPattern = /bilibili\.com/;
    if (!domainPattern.test(hostname)) return false;

    const articlePathPattern = /\/read\/cv|\/article\/|\/opus\//;
    if (!articlePathPattern.test(url)) return false;

    return true;
  }

  extract(): ExtractResult {
    const title = this.extractTitle();
    let content = this.extractContent();
    if (content instanceof HTMLElement) {
      this.cleanContent(content);
    }
    const leadingImage = this.extractLeadingImage();
    const excerpt = this.extractExcerpt();

    return {
      title,
      content,
      excerpt,
      leadingImage,
      extractor: this.meta.id,
    };
  }

  private extractTitle(): string {
    const selectors = [
      "h1.title",
      ".article-title",
      ".title",
      "h1",
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
      docTitle = docTitle
        .replace(/\s*[-|]\s*(哔哩哔哩|Bilibili).*$/i, "")
        .trim();
      if (docTitle) return docTitle;
    }

    return "无标题";
  }

  private extractContent(): HTMLElement | null {
    // 优先提取 .opus-module-content（包含所有内容）
    const mainContent = document.querySelector(
      ".opus-module-content",
    ) as HTMLElement | null;
    if (mainContent && mainContent.innerText.trim().length > 50) {
      return mainContent;
    }

    // 备选方案：提取 .opus-paragraph-children（纯内容段落）
    const paragraphContent = document.querySelector(
      ".opus-paragraph-children",
    ) as HTMLElement | null;
    if (paragraphContent && paragraphContent.innerText.trim().length > 50) {
      return paragraphContent;
    }

    return null;
  }

  private extractLeadingImage(): string | undefined {
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage?.getAttribute("content")?.startsWith("http")) {
      return ogImage.getAttribute("content")!;
    }

    const metaImage = document.querySelector('meta[name="image"]');
    if (metaImage?.getAttribute("content")?.startsWith("http")) {
      return metaImage.getAttribute("content")!;
    }

    const coverSelectors = [
      ".opus-module-top__album__cover img",
      ".opus-para-pic img",
      ".bili-dyn-pic__img img",
      ".cover img",
      ".article-cover img",
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

    const contentElement = this.extractContent();
    if (contentElement instanceof HTMLElement) {
      const imgs = contentElement.querySelectorAll("img");
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

  private extractExcerpt(): string | undefined {
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc?.getAttribute("content")?.trim()) {
      return metaDesc.getAttribute("content")!.trim();
    }

    const subtitle = document.querySelector(".subtitle, .abstract");
    if (subtitle?.textContent?.trim()) {
      return subtitle.textContent.trim();
    }

    const contentElement = this.extractContent();
    if (contentElement instanceof HTMLElement) {
      const text = contentElement.innerText.trim();
      if (text.length > 0) {
        return text.slice(0, 200) + (text.length > 200 ? "…" : "");
      }
    }

    return undefined;
  }

  private cleanContent(root: HTMLElement): void {
    // 使用基类提供的通用清理方法
    this.cleanInterferenceElements(root);

    // B站特有的清理选择器
    const bilibiliSpecificSelectors = [
      // B站模块
      ".opus-module-top",
      ".opus-module-footer",
      ".opus-module-author",
      ".opus-module-share",
      ".opus-module-comment",
      ".opus-module-recommend",
      ".opus-module-stat",
      ".opus-module-tool",
      ".opus-module-more",
      ".opus-module-related",
      ".opus-module-bottom",
      // 侧边栏和底部
      ".side-toolbar",
      ".side-toolbar__box",
      ".right-float-bar",
      ".sidebar",
      ".footer",
      ".bottom",
      // 操作按钮
      ".like-wrapper",
      ".follow-btn",
      ".action-bar",
      ".report-btn",
    ];

    for (const selector of bilibiliSpecificSelectors) {
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
