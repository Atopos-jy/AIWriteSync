/**
 * 文章处理工具类
 * 实现多平台同步的通用规则
 */
import type { Article } from "../types";

export interface PlatformCapabilities {
  /** 是否支持标签 */
  supportsTags: boolean;
  /** 是否支持摘要 */
  supportsSummary: boolean;
  /** 是否支持分类 */
  supportsCategory: boolean;
  /** 是否支持封面图 */
  supportsCover: boolean;
  /** 是否支持独立作者字段 */
  supportsAuthor: boolean;
}

/**
 * 文章处理器
 */
export class ArticleProcessor {
  /**
   * 处理文章内容，根据平台能力拼接最终内容
   * @param article 文章数据
   * @param capabilities 平台能力
   * @returns 处理后的文章内容
   */
  static processContent(
    article: Article,
    capabilities: PlatformCapabilities,
  ): {
    title: string;
    content: string;
    tags: string[];
    summary: string;
    category: string;
    author: string | undefined;
    cover: string | undefined;
    publishDate: string | undefined;
    url: string | undefined;
    articleType: string | undefined;
  } {
    const { content, summary, tags, category, articleType, url } = article;

    let finalContent = content || "";
    let apiTags: string[] = [];
    let apiSummary: string = "";
    let apiCategory: string = "";

    // 1. 处理标签
    if (capabilities.supportsTags && tags && tags.length > 0) {
      apiTags = tags;
    } else if (tags && tags.length > 0) {
      // 不支持标签的平台，在正文最前面拼接标签
      const tagLine = `标签：${tags.map((tag) => `#${tag}`).join(" ")}`;
      finalContent = `${tagLine}\n${finalContent}`;
    }

    // 2. 处理摘要
    if (capabilities.supportsSummary && summary) {
      apiSummary = summary;
    } else if (summary) {
      // 不支持摘要的平台，在标签下方、正文上方拼接摘要（使用引用样式）
      const summaryLine = `> **摘要：** ${summary}`;
      finalContent = `${finalContent.split("\n")[0]}\n${summaryLine}\n${finalContent.split("\n").slice(1).join("\n")}`;
    }

    // 3. 处理分类
    if (capabilities.supportsCategory && category) {
      apiCategory = category;
    }

    // 4. 添加版权声明（文末）
    const copyright = "\n\n";
    if (articleType === "original") {
      finalContent += copyright + "**本文为原创文章，未经允许禁止转载。**";
    } else if (url) {
      finalContent += copyright + `**本文转载自：** [${url}](${url})`;
    }

    return {
      title: article.title,
      content: finalContent,
      tags: apiTags,
      summary: apiSummary,
      category: apiCategory,
      author: article.author,
      cover: article.cover,
      publishDate: article.publishDate,
      url: article.url,
      articleType: article.articleType,
    };
  }

  /**
   * 处理HTML内容
   * @param article 文章数据
   * @param capabilities 平台能力
   * @returns 处理后的HTML内容
   */
  static processHtmlContent(
    article: Article,
    capabilities: PlatformCapabilities,
  ): {
    title: string;
    content: string;
    tags: string[];
    summary: string;
    category: string;
    author: string | undefined;
    cover: string | undefined;
    publishDate: string | undefined;
    url: string | undefined;
    articleType: string | undefined;
  } {
    const { html, summary, tags, category, articleType, url } = article;

    let finalHtml = html || "";
    let apiTags: string[] = [];
    let apiSummary: string = "";
    let apiCategory: string = "";

    // 1. 处理标签
    if (capabilities.supportsTags && tags && tags.length > 0) {
      apiTags = tags;
    } else if (tags && tags.length > 0) {
      // 不支持标签的平台，在正文最前面拼接标签
      const tagLine = `<p>标签：${tags.map((tag) => `<span>#${tag}</span>`).join(" ")}</p>`;
      finalHtml = `${tagLine}${finalHtml}`;
    }

    // 2. 处理摘要
    if (capabilities.supportsSummary && summary) {
      apiSummary = summary;
    } else if (summary) {
      // 不支持摘要的平台，在标签下方、正文上方拼接摘要（使用特定的引用样式）
      const summaryLine = `<blockquote class="text-gray-500"><p><strong>摘要：</strong>${summary}</p></blockquote>`;
      finalHtml = `${finalHtml.split("\n")[0]}\n${summaryLine}${finalHtml.split("\n").slice(1).join("\n")}`;
    }

    // 3. 处理分类
    if (capabilities.supportsCategory && category) {
      apiCategory = category;
    }

    // 4. 添加版权声明（文末）
    const copyright = "\n";
    if (articleType === "original") {
      finalHtml +=
        copyright +
        "<p><strong>本文为原创文章，未经允许禁止转载。</strong></p>";
    } else if (url) {
      finalHtml +=
        copyright +
        `<p><strong>本文转载自：</strong> <a href="${url}" target="_blank">${url}</a></p>`;
    }

    return {
      title: article.title,
      content: finalHtml,
      tags: apiTags,
      summary: apiSummary,
      category: apiCategory,
      author: article.author,
      cover: article.cover,
      publishDate: article.publishDate,
      url: article.url,
      articleType: article.articleType,
    };
  }
}
