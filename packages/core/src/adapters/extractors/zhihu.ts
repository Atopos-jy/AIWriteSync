import { BaseAdapter } from "../base";
import type {
  PlatformMeta,
  AuthResult,
  SyncResult,
  Article,
} from "../../types";

/**
 * 知乎文章提取结果接口
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
 * 知乎文章提取专用适配器
 * 用于从知乎文章页提取标题、正文、封面、摘要，并自动清理干扰元素
 */
export class ZhihuExtractAdapter extends BaseAdapter {
  /** 平台元信息 */
  readonly meta: PlatformMeta = {
    id: "zhihu-extract",
    name: "知乎文章提取",
    icon: "https://static.zhihu.com/heifetz/assets/favicon.ico",
    homepage: "https://www.zhihu.com",
    capabilities: [],
  };

  /**
   * 匹配当前页面是否属于知乎文章页
   */
  async match(): Promise<boolean> {
    const url = window.location.href;
    const hostname = window.location.hostname;

    // 1. 域名匹配
    const domainPattern = /zhihu\.com/;
    if (!domainPattern.test(hostname)) return false;

    // 2. 路径匹配：文章页
    const articlePathPattern = /\/p\//;
    if (!articlePathPattern.test(url)) return false;

    return true;
  }

  /**
   * 提取文章内容
   */
  extract(): ExtractResult {
    // 提取标题
    const titleElement = document.querySelector(".Post-Title");
    const title = titleElement?.textContent?.trim() || "";

    // 提取正文
    let contentElement: HTMLElement | null = null;
    const contentSelectors = [
      ".RichText.ztext.Post-RichText",
      ".RichText.ztext.Post-RichText.css-1oz8dhe",
      "#content .RichText",
      ".Post-RichText",
      ".Post-RichTextContainer .RichText",
    ];

    for (const selector of contentSelectors) {
      const element = document.querySelector(selector) as HTMLElement | null;
      if (element && element.innerText.trim().length > 50) {
        contentElement = element;
        break;
      }
    }

    // 提取封面图片
    let leadingImage: string | undefined;
    const pictureElement = document.querySelector("picture");
    if (pictureElement) {
      const imgElement = pictureElement.querySelector("img");
      if (imgElement) {
        leadingImage =
          imgElement.src ||
          imgElement.getAttribute("data-actualsrc") ||
          imgElement.getAttribute("data-original") ||
          undefined;
      }
    }

    // 如果没有找到picture，尝试直接找封面图片
    if (!leadingImage) {
      const coverImg =
        document.querySelector(".Post-MainImage img") ||
        document.querySelector(".RichText-ConditionalImagePortal img");
      if (coverImg) {
        leadingImage =
          (coverImg as HTMLImageElement).src ||
          coverImg.getAttribute("data-actualsrc") ||
          coverImg.getAttribute("data-original") ||
          undefined;
      }
    }

    // 提取摘要
    let excerpt: string | undefined;
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      excerpt = metaDescription.getAttribute("content")?.trim();
    }

    // 如果没有找到meta摘要，尝试从正文提取第一段落
    if (!excerpt && contentElement) {
      const firstParagraph = contentElement.querySelector("p");
      if (firstParagraph) {
        excerpt = firstParagraph.textContent?.trim();
      }
    }

    // 清理干扰元素
    if (contentElement) {
      // 使用基类提供的通用清理方法
      this.cleanInterferenceElements(contentElement);

      // 知乎特有的清理选择器
      const zhihuSpecificSelectors = [
        ".Recommend-Mixed",
        ".Related-Questions",
        ".CommentList",
        ".Post-Author",
        ".Post-Attention",
        ".Post-Vote",
        ".Post-Toolbar",
        ".AuthorInfo",
        ".UserLink",
        ".RichText-Placeholder",
        ".ContentItem-actions",
        ".CommentSection",
        ".QuestionPage-footer",
        ".QuestionPage-sideColumn",
        ".ztext-empty-paragraph",
      ];

      zhihuSpecificSelectors.forEach((selector) => {
        const elements = contentElement.querySelectorAll(selector);
        elements.forEach((element) => {
          element.remove();
        });
      });
    }

    return {
      title,
      content: contentElement,
      excerpt,
      leadingImage,
      extractor: "zhihu-extract",
    };
  }

  async checkAuth(): Promise<AuthResult> {
    return { isAuthenticated: true, userId: "", username: "" };
  }

  async publish(_article: Article): Promise<SyncResult> {
    throw new Error("Extract adapter does not support publish operation");
  }
}
