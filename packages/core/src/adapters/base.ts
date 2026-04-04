import type { Article, AuthResult, SyncResult, PlatformMeta } from "../types";
import type { RuntimeInterface } from "../runtime/interface";
import type { PlatformAdapter } from "./types";

/**
 * 适配器基类
 * 提供通用的请求处理和模板解析
 */
export abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly meta: PlatformMeta;
  protected runtime!: RuntimeInterface;
  protected context: Record<string, unknown> = {};

  async init(runtime: RuntimeInterface): Promise<void> {
    this.runtime = runtime;
  }

  abstract checkAuth(): Promise<AuthResult>;
  abstract publish(article: Article): Promise<SyncResult>;
  abstract match?(): Promise<boolean>;
  /**
   * 发送请求
   */
  protected async request<T = unknown>(
    url: string,
    options: RequestInit = {},
  ): Promise<T> {
    const response = await this.runtime.fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return response.json();
    }

    return response.text() as T;
  }

  /**
   * 带重试的请求
   */
  protected async requestWithRetry<T = unknown>(
    url: string,
    options: RequestInit = {},
    maxRetries = 3,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.request<T>(url, options);
      } catch (error) {
        lastError = error as Error;
        if (i < maxRetries - 1) {
          await this.delay(1000 * (i + 1));
        }
      }
    }

    throw lastError;
  }

  /**
   * 延迟
   */
  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 创建同步结果
   */
  protected createResult(
    success: boolean,
    data?: Partial<SyncResult>,
  ): SyncResult {
    return {
      platform: this.meta.id,
      success,
      timestamp: Date.now(),
      ...data,
    };
  }

  /**
   * 通用清理方法 - 清理干扰元素
   */
  protected cleanInterferenceElements(root: HTMLElement): void {
    // 通用清理选择器
    const commonRemoveSelectors = [
      ".recommend",
      ".feed-card",
      ".related-article",
      ".hot-recommend",
      ".sidebar",
      ".ad",
      ".feed-wrapper",
      ".article-recommend",
      ".comment-list",
      ".share-bar",
      ".like-wrapper",
      ".follow-btn",
      ".recommend-article",
      ".hot-list",
      ".side-toolbar",
      ".right-float-bar",
      ".article-tags",
      ".source-info",
      ".action-bar",
      ".report-btn",
      ".article-feed",
      ".recommend-wrap",
      ".similar-news",
      ".xg-ad",
      ".pgo-ad",
      "[class*='ad-']",
      "[class*='banner']",
      "[id*='ad']",
      "iframe[src*='ad']",
      ".author-info",
      ".author-card",
      ".article-meta",
      ".article-footer",
      ".article-tools",
      ".article-share",
      ".article-comment",
      ".article-vote",
      ".article-collect",
      ".article-report",
      ".article-more",
      ".article-relate",
      ".article-next",
      ".article-prev",
      ".article-nav",
      ".article-banner",
      ".article-header",
      ".article-title",
      ".article-subtitle",
      ".article-date",
      ".article-source",
      ".article-author",
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

    for (const selector of commonRemoveSelectors) {
      try {
        root.querySelectorAll(selector).forEach((el) => el.remove());
      } catch (e) {}
    }

    // 文本关键词清理
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }

    for (const node of textNodes) {
      if (
        node.textContent &&
        /广告|推广|赞助|AD|广告位/.test(node.textContent)
      ) {
        let parent = node.parentElement;
        let level = 0;
        while (parent && level < 3) {
          if (["DIV", "SECTION", "ARTICLE"].includes(parent.tagName)) {
            if (
              parent.innerText.length < 200 &&
              /广告|推广/.test(parent.innerText)
            ) {
              parent.remove();
              break;
            }
          }
          parent = parent.parentElement;
          level++;
        }
      }
    }

    // 清理空的段落
    const emptyParagraphs = root.querySelectorAll("p:empty");
    emptyParagraphs.forEach((p) => p.remove());

    // 清理只包含空白的段落
    const whitespaceParagraphs = root.querySelectorAll("p");
    whitespaceParagraphs.forEach((p) => {
      if (p.textContent?.trim() === "") {
        p.remove();
      }
    });
  }
}
