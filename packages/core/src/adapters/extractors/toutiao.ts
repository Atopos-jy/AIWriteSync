// core/src/adapters/extractors/toutiao.ts

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

export class ToutiaoExtractAdapter extends BaseAdapter {
  readonly meta: PlatformMeta = {
    id: "toutiao-extract",
    name: "头条文章提取",
    icon: "https://p9-flow-sign.byteimg.com/tos-cn-i-qvj2lq49k0/d94f25898d78486c827cc8b152d69527~tplv-qvj2lq49k0-image.image",
    homepage: "https://www.toutiao.com",
    capabilities: [],
  };

  async match(): Promise<boolean> {
    const url = window.location.href;
    const hostname = window.location.hostname;
    if (!/toutiao\.com|toutiaocdn\.com|byteimg\.com/.test(hostname))
      return false;
    if (
      !/\/item\/|\/group\/|\/article\/|\/p\/|\/publish\/|\/editor\//.test(url)
    )
      return false;
    if (/\/mp\.toutiao\.com\/$|\/admin\//.test(url)) return false;
    return true;
  }

  extract(): ExtractResult {
    const title = this.extractTitle();
    let contentEl = this.extractContentContainer();
    if (contentEl) {
      this.cleanContent(contentEl);
    } else {
      contentEl = this.fallbackFindContentContainer();
    }
    const leadingImage = this.extractLeadingImage();
    const excerpt = this.extractExcerpt(contentEl);
    return {
      title,
      content: contentEl,
      excerpt,
      leadingImage,
      extractor: this.meta.id,
    };
  }

  private extractTitle(): string {
    // 编辑页
    const editorTitle = document.querySelector(
      ".publish-editor-title textarea, .editor-title textarea",
    ) as HTMLTextAreaElement;
    if (editorTitle?.value?.trim()) return editorTitle.value.trim();
    // 阅读页
    const selectors = [
      ".article-content h1",
      "h1.article-title",
      ".article-title",
      "h1",
      ".title",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.textContent?.trim()) return el.textContent.trim();
    }
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle?.getAttribute("content")?.trim())
      return ogTitle.getAttribute("content")!;
    let docTitle = document.title;
    if (docTitle) {
      docTitle = docTitle
        .replace(/\s*[-|]\s*(头条|今日头条|TouTiao).*$/i, "")
        .trim();
      if (docTitle) return docTitle;
    }
    return "无标题";
  }

  private extractContentContainer(): HTMLElement | null {
    // 编辑页
    const proseMirror = document.querySelector(".ProseMirror") as HTMLElement;
    if (proseMirror?.innerText.trim().length > 50) return proseMirror;

    // 阅读页：精确正文容器
    const articleBody = document.querySelector(
      "article.syl-article-base, .syl-page-article, .tt-article-content",
    );
    if (
      articleBody &&
      (articleBody as HTMLElement).innerText.trim().length > 200
    ) {
      return articleBody as HTMLElement;
    }

    // 备选：.article-content 内部清理
    const articleContent = document.querySelector(
      ".article-content",
    ) as HTMLElement;
    if (articleContent) {
      const clone = articleContent.cloneNode(true) as HTMLElement;
      const h1 = clone.querySelector(":scope > h1");
      if (h1) h1.remove();
      const meta = clone.querySelector(".article-meta");
      if (meta) meta.remove();
      const innerArticle = clone.querySelector("article");
      if (innerArticle) return innerArticle as HTMLElement;
      if (clone.innerText.trim().length > 200) return clone;
    }

    // 通用文本密度
    const candidates = document.querySelectorAll(
      "div[class*='article'], div[class*='content'], main, article",
    );
    let best: HTMLElement | null = null;
    let maxLen = 0;
    for (const el of candidates) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.offsetHeight === 0) continue;
      const len = htmlEl.innerText.trim().length;
      if (len > maxLen && len > 500) {
        maxLen = len;
        best = htmlEl;
      }
    }
    return best;
  }

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

  private extractLeadingImage(): string | undefined {
    // 1. 编辑页封面
    const coverImg = document.querySelector(
      ".article-cover-img-wrap img, .article-cover img",
    ) as HTMLImageElement;
    if (coverImg?.src?.startsWith("http")) return coverImg.src;

    // 2. Open Graph 图片
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage?.getAttribute("content")?.startsWith("http"))
      return ogImage.getAttribute("content")!;

    // 3. 背景图片封面（新增）
    const bgPicElement = document.querySelector(
      "i.pic, .pic, [class*='pic']",
    ) as HTMLElement;
    if (bgPicElement) {
      const bgImage = bgPicElement.style.backgroundImage;
      if (bgImage && bgImage !== "none") {
        const match = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
        if (match?.[1] && match[1].startsWith("http")) {
          // 处理可能缺少协议的情况
          let url = match[1];
          if (url.startsWith("//")) url = "https:" + url;
          return url;
        }
      }
    }

    // 4. 阅读页封面选择器
    const coverSelectors = [
      ".article-cover img",
      ".detail-cover img",
      ".banner img",
    ];
    for (const sel of coverSelectors) {
      const img = document.querySelector(sel) as HTMLImageElement;
      if (img) {
        const src = img.getAttribute("src") || img.getAttribute("data-src");
        if (src?.startsWith("http")) return src;
      }
    }

    // 5. 从正文中取第一张大图
    const contentContainer = this.extractContentContainer();
    if (contentContainer) {
      const imgs = contentContainer.querySelectorAll("img");
      for (const img of imgs) {
        const src = img.getAttribute("src") || img.getAttribute("data-src");
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

  private extractExcerpt(contentEl: HTMLElement | null): string | undefined {
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc?.getAttribute("content")?.trim())
      return metaDesc.getAttribute("content")!.trim();
    const subtitle = document.querySelector(
      ".article-subtitle, .subtitle, .summary",
    );
    if (subtitle?.textContent?.trim()) return subtitle.textContent.trim();
    if (contentEl) {
      const text = contentEl.innerText.trim();
      if (text.length > 0)
        return text.slice(0, 200) + (text.length > 200 ? "…" : "");
    }
    return undefined;
  }

  private cleanContent(root: HTMLElement): void {
    // 使用基类提供的通用清理方法
    this.cleanInterferenceElements(root);

    // 头条特有的清理选择器
    const toutiaoSpecificSelectors = [
      ".publish-setting",
      ".editor-sidebar",
      ".syl-editor-toolbar",
      ".mp-editor-keymap-guide-button",
      ".publish-footer",
      ".form-wrap",
      ".new-plugin-helper",
    ];

    for (const selector of toutiaoSpecificSelectors) {
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
