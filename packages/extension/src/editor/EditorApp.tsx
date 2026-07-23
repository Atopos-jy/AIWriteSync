import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Check,
  Loader2,
  ExternalLink,
  Edit2,
  Eye,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Link,
  Image,
  Strikethrough,
  Sparkles,
  Wand2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { createLogger } from "../lib/logger";
import { useDebounce } from "use-debounce";
import { htmlToMarkdownNative, markdownToHtml } from "@aiwritesync/core";
import { marked } from "marked";
import { TipTapEditor } from "./TipTapEditor";
import { useAIPolish } from "./useAIPolish";
const logger = createLogger("Editor");

export interface Article {
  title: string;
  author?: string;
  summary?: string;
  content: string;
  cover?: string;
  url?: string;
  tags?: string[];
  category?: string;
  articleType?: string;
  publishDate?: string;
  //文章字段
  html?: string;
  markdown?: string;
}

interface DropdownProps {
  children: React.ReactNode;
  position: { top: number; left: number };
}

function Dropdown({ children, position }: DropdownProps) {
  return createPortal(
    <div
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 999999,
      }}
      className="w-40 bg-white border border-gray-200 rounded-lg shadow-lg"
    >
      {children}
    </div>,
    document.body,
  );
}

interface Platform {
  id: string;
  name: string;
  icon: string;
  isAuthenticated: boolean;
  username?: string;
}

interface SyncResult {
  platform: string;
  platformName?: string;
  success: boolean;
  postUrl?: string;
  error?: string;
}

// 同步阶段类型
type SyncStage =
  | "starting"
  | "uploading_images"
  | "saving"
  | "completed"
  | "failed";

// 平台同步详细进度
interface PlatformProgress {
  platform: string;
  platformName: string;
  stage: SyncStage;
  imageProgress?: { current: number; total: number };
  error?: string;
}

type SyncStatus = "idle" | "syncing" | "completed";

// Storage key for selected platforms (same as popup)
const SELECTED_PLATFORMS_KEY = "selectedPlatforms";

/**
 * 从平台列表中过滤出已登录的平台
 */
function getAuthenticatedPlatforms(platforms: Platform[]) {
  return platforms.filter((p: Platform) => p.isAuthenticated);
}

/**
 * 将平台数据与登录状态结合
 */
function mergePlatformsWithAuth(
  platforms: Platform[],
  authCache: Record<string, any> = {},
) {
  const now = Date.now();

  return platforms.map((platform) => {
    const authItem = authCache[platform.id];
    // 检查缓存是否有效（已登录5分钟，未登录30秒）
    const cacheTTL = authItem?.isAuthenticated ? 5 * 60 * 1000 : 30 * 1000;
    const cacheValid = authItem && now - authItem.timestamp < cacheTTL;

    return {
      ...platform,
      isAuthenticated: cacheValid ? authItem.isAuthenticated : false,
      username: cacheValid ? authItem.username : undefined,
      error: cacheValid ? authItem.error : undefined,
    };
  });
}

// 保存选中的平台到 storage
function saveSelectedPlatforms(platformIds: string[]) {
  chrome.storage.local
    .set({ [SELECTED_PLATFORMS_KEY]: platformIds })
    .catch((e) => {
      logger.error("Failed to save selected platforms:", e);
    });
}

export function EditorApp() {
  const [article, setArticle] = useState<Article | null>(null);
  const [editorMode, setEditorMode] = useState<"preview" | "edit">("preview");
  const [isMDMode, setIsMDMode] = useState<boolean>(false);
  const [tiptapEditor, setTiptapEditor] = useState<any>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(
    new Set(),
  );
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [results, setResults] = useState<SyncResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitWarning, setRateLimitWarning] = useState<string | null>(null);
  const [platformProgress, setPlatformProgress] = useState<
    Map<string, PlatformProgress>
  >(new Map());
  const [currentSyncId, setCurrentSyncId] = useState<string | null>(null);
  const currentSyncIdRef = useRef<string | null>(null);
  const [showImageMenu, setShowImageMenu] = useState<boolean>(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [imageMenuPos, setImageMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // AI 润色
  const {
    loading: aiLoading,
    error: aiError,
    clearError: clearAIError,
    checkConfigured,
    polishTitle,
    polishContent,
    generateSummary,
    suggestTags,
  } = useAIPolish();

  // 标题建议弹窗
  const [titleSuggestions, setTitleSuggestions] = useState<string[]>([]);
  const [selectedTitleIndex, setSelectedTitleIndex] = useState(0);
  const [showTitlePanel, setShowTitlePanel] = useState(false);

  const [debouncedArticle] = useDebounce(article, 1000);

  const mdContentRef = useRef<HTMLTextAreaElement>(null);
  const richContentRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const imageMenuRef = useRef<HTMLDivElement>(null);

  // Markdown模式下插入格式
  const insertMarkdownFormat = (prefix: string, suffix: string) => {
    if (!mdContentRef.current) return;
    const textarea = mdContentRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    const newValue =
      textarea.value.substring(0, start) +
      prefix +
      selectedText +
      suffix +
      textarea.value.substring(end);
    textarea.value = newValue;
    updateArticle("content", newValue);
    textarea.focus();
    textarea.setSelectionRange(
      start + prefix.length,
      end + prefix.length + selectedText.length,
    );
  };

  // Markdown模式下插入标题
  const insertMarkdownHeader = (level: number) => {
    if (!mdContentRef.current) return;
    const textarea = mdContentRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);

    // 找到当前行的开始位置
    let lineStart = start;
    while (lineStart > 0 && textarea.value[lineStart - 1] !== "\n") {
      lineStart--;
    }

    // 找到当前行的结束位置
    let lineEnd = end;
    while (
      lineEnd < textarea.value.length &&
      textarea.value[lineEnd] !== "\n"
    ) {
      lineEnd++;
    }

    const headerPrefix = "#".repeat(level) + " ";
    const newValue =
      textarea.value.substring(0, lineStart) +
      headerPrefix +
      selectedText +
      "\n" +
      textarea.value.substring(lineEnd);
    textarea.value = newValue;
    updateArticle("content", newValue);
    textarea.focus();
    textarea.setSelectionRange(
      lineStart + headerPrefix.length + selectedText.length + 1,
      lineStart + headerPrefix.length + selectedText.length + 1,
    );
  };

  // Markdown模式下插入列表
  const insertMarkdownList = (prefix: string) => {
    if (!mdContentRef.current) return;
    const textarea = mdContentRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);

    // 找到当前行的开始位置
    let lineStart = start;
    while (lineStart > 0 && textarea.value[lineStart - 1] !== "\n") {
      lineStart--;
    }

    // 找到当前行的结束位置
    let lineEnd = end;
    while (
      lineEnd < textarea.value.length &&
      textarea.value[lineEnd] !== "\n"
    ) {
      lineEnd++;
    }

    const newValue =
      textarea.value.substring(0, lineStart) +
      prefix +
      selectedText +
      "\n" +
      textarea.value.substring(lineEnd);
    textarea.value = newValue;
    textarea.focus();
    textarea.setSelectionRange(
      lineStart + prefix.length + selectedText.length + 1,
      lineStart + prefix.length + selectedText.length + 1,
    );
  };

  // Markdown模式下插入缩进
  const insertMarkdownIndent = (increase: boolean) => {
    if (!mdContentRef.current) return;
    const textarea = mdContentRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    // 找到当前行的开始位置
    let lineStart = start;
    while (lineStart > 0 && textarea.value[lineStart - 1] !== "\n") {
      lineStart--;
    }

    const indent = increase ? "  " : "";
    let newValue;

    if (increase) {
      newValue =
        textarea.value.substring(0, lineStart) +
        indent +
        textarea.value.substring(lineStart);
    } else {
      // 移除缩进
      const currentLine = textarea.value.substring(
        lineStart,
        textarea.value.indexOf("\n", lineStart) !== -1
          ? textarea.value.indexOf("\n", lineStart)
          : textarea.value.length,
      );
      const trimmedLine = currentLine.replace(/^\s{2}/, "");
      newValue =
        textarea.value.substring(0, lineStart) +
        trimmedLine +
        textarea.value.substring(lineStart + currentLine.length);
    }

    textarea.value = newValue;
    textarea.focus();
  };

  // Markdown模式下插入分隔线
  const insertMarkdownHorizontalRule = () => {
    if (!mdContentRef.current) return;
    const textarea = mdContentRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    const newValue =
      textarea.value.substring(0, start) +
      "\n---\n" +
      textarea.value.substring(end);
    textarea.value = newValue;
    textarea.focus();
    textarea.setSelectionRange(start + 5, start + 5);
  };

  // Markdown模式下插入代码块
  const insertMarkdownCode = () => {
    if (!mdContentRef.current) return;
    const textarea = mdContentRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);

    // 获取语言输入
    const language = prompt("输入代码语言（可选）:") || "";
    const languagePrefix = language ? `${language}\n` : "";

    const codeBlock = "```" + (language ? " " + language : "") + "\n";
    const newValue =
      textarea.value.substring(0, start) +
      codeBlock +
      selectedText +
      "\n```\n" +
      textarea.value.substring(end);
    textarea.value = newValue;
    updateArticle("content", newValue);
    textarea.focus();
    textarea.setSelectionRange(
      start + codeBlock.length,
      end + codeBlock.length + selectedText.length,
    );
  };

  const toggleMenu = () => {
    if (!buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();

    setImageMenuPos({
      top: rect.bottom + 4,
      left: rect.left,
    });

    setShowImageMenu((prev) => !prev);
  };

  const insertLink = () => {
    // MD 模式且处于编辑模式
    if (isMDMode && editorMode === "edit") {
      if (!mdContentRef.current) return;
      const textarea = mdContentRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = textarea.value.substring(start, end);
      const url = prompt("输入链接URL:");
      if (url) {
        const newValue =
          textarea.value.substring(0, start) +
          "[" +
          (selectedText || "链接") +
          "](" +
          url +
          ")" +
          textarea.value.substring(end);
        textarea.value = newValue;
        textarea.focus();
        // 光标定位到链接文本之后
        const newCursorPos =
          start + (selectedText ? selectedText.length + 3 : 3);
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }
    } else if (!isMDMode) {
      // 富文本模式 - 使用 TipTap API
      if (!tiptapEditor) return;
      const url = prompt("输入链接URL:");
      if (url) {
        const text = prompt("输入链接文字:", "链接");
        if (!text) return;

        // 使用 TipTap 命令插入链接
        tiptapEditor.commands.insertContent(`<a href="${url}">${text}</a>`);
      }
    }
  };
  // 通过URL插入图片
  const insertImageByUrl = () => {
    setShowImageMenu(false);
    if (isMDMode && editorMode === "edit") {
      if (!mdContentRef.current) return;
      const textarea = mdContentRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = textarea.value.substring(start, end);
      const url = prompt("输入图片URL:");
      if (url) {
        const newValue =
          textarea.value.substring(0, start) +
          "![" +
          (selectedText || "图片") +
          "](" +
          url +
          ")" +
          textarea.value.substring(end);
        textarea.value = newValue;
        updateArticle("content", newValue);
        textarea.focus();
        const newCursorPos =
          start +
          2 +
          (selectedText ? selectedText.length + 3 : 3) +
          url.length +
          2;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }
    } else if (!isMDMode) {
      // 富文本模式 - 使用 TipTap API
      if (!tiptapEditor) return;
      const url = prompt("输入图片URL:");
      if (url) {
        // 使用 TipTap 命令插入图片
        tiptapEditor.commands
          .insertContent(`<img src="${url}" alt="图片" />`)
          .then(() => {
            // 更新 article.content
            updateArticle("content", tiptapEditor.getHTML());
          });
      }
    }
  };

  // 上传图片
  const uploadImage = () => {
    setShowImageMenu(false);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        if (isMDMode && editorMode === "edit") {
          if (!mdContentRef.current) return;
          const textarea = mdContentRef.current;
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const selectedText = textarea.value.substring(start, end);
          const newValue =
            textarea.value.substring(0, start) +
            "![" +
            (selectedText || "图片") +
            "](" +
            dataUrl +
            ")" +
            textarea.value.substring(end);
          textarea.value = newValue;
          updateArticle("content", newValue);
          textarea.focus();
          const newCursorPos =
            start +
            2 +
            (selectedText ? selectedText.length + 3 : 3) +
            dataUrl.length +
            2;
          textarea.setSelectionRange(newCursorPos, newCursorPos);
        } else if (!isMDMode && tiptapEditor) {
          // 富文本模式 - 使用 TipTap API
          tiptapEditor.commands.focus();
          const success = tiptapEditor.commands.setImage({
            src: dataUrl,
            alt: "图片",
          });
          if (success) {
            // 同步更新 article.content
            updateArticle("content", tiptapEditor.getHTML());
          } else {
            console.error("setImage 命令失败");
          }
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const updateArticle = useCallback(
    <K extends keyof Article>(key: K, value: Article[K]) => {
      setArticle((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    [],
  );

  // article.content，切换模式时做一次 HTML↔Markdown 转换
  const switchEditorMode = useCallback(
    (nextIsMDMode: boolean) => {
      if (!article) {
        setIsMDMode(nextIsMDMode);
        if (nextIsMDMode) setEditorMode("edit");
        return;
      }
      if (nextIsMDMode === isMDMode) return;

      if (nextIsMDMode) {
        // 富文本 → Markdown
        const currentHtml =
          tiptapEditor?.getHTML() ??
          richContentRef.current?.innerHTML ??
          article.content ??
          "";
        const md = htmlToMarkdownNative(currentHtml); // 使用完善的转换函数
        setArticle((prev) =>
          prev
            ? {
                ...prev,
                content: md, // 当前编辑器内容改为 Markdown
                markdown: md,
                html: currentHtml,
              }
            : prev,
        );
        setIsMDMode(true);
        setEditorMode("edit");
      } else {
        // Markdown → 富文本
        const currentMd =
          mdContentRef.current?.value ??
          article.markdown ??
          article.content ??
          "";
        const html = markdownToHtml(currentMd); // 使用完善的转换函数
        setArticle((prev) =>
          prev
            ? {
                ...prev,
                content: html, // 当前编辑器内容改为 HTML
                markdown: currentMd,
                html: html,
              }
            : prev,
        );
        setIsMDMode(false);
      }
    },
    [article, isMDMode, tiptapEditor],
  );

  const renderMarkdown = useCallback((content: string) => {
    const html = marked.parse(content, { async: false }) as string;
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  }, []);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        imageMenuRef.current &&
        !imageMenuRef.current.contains(event.target as Node)
      ) {
        setShowImageMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  //自动保存到本地
  useEffect(() => {
    if (debouncedArticle) {
      chrome.storage.local
        .set({
          draftArticle: debouncedArticle,
          lastSaved: Date.now(),
        })
        .catch((e) => logger.error("Failed to save draft:", e));
    }
  }, [debouncedArticle]);
  // 保持 ref 与 state 同步
  useEffect(() => {
    currentSyncIdRef.current = currentSyncId;
  }, [currentSyncId]);

  //refs 用于获取输入框的值
  const titleRef = useRef<HTMLHeadingElement>(null);
  const authorRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 接收来自父窗口的消息
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        console.log("[Editor] Received message:", data);
        // 如果消息带有 syncId，需要匹配当前的 syncId
        if (data.syncId) {
          // 如果当前没有 syncId，保存这个 syncId（新同步开始）
          if (!currentSyncIdRef.current) {
            setCurrentSyncId(data.syncId);
          } else if (data.syncId !== currentSyncIdRef.current) {
            // 如果已有 syncId 且不匹配，忽略消息
            logger.debug(
              "Ignoring message with different syncId:",
              data.syncId,
              "current:",
              currentSyncIdRef.current,
            );
            return;
          }
        }

        logger.debug("Received message:", data);

        if (data.type === "ARTICLE_DATA") {
          let html = data.article.html || data.article.content || "";
          let markdown = data.article.markdown || "";

          // 如果只提供了 markdown，没有 html，则转换
          if (!html && markdown) {
            html = markdownToHtml(markdown);
          }
          // 如果只提供了 html，没有 markdown，则生成一个
          if (!markdown && html) {
            markdown = htmlToMarkdownNative(html);
          }

          // 根据当前模式决定显示哪种格式（但两种都存储）
          const content = isMDMode ? markdown : html;
          setArticle({
            title: data.article.title || "",
            author: data.article.author || "",
            summary: data.article.summary || "",
            content, // 当前编辑器使用的内容
            cover: data.article.cover || "",
            tags: data.article.tags || [],
            url: data.article.url || "",
            category: data.article.category || "",
            articleType: data.article.articleType || "",
            publishDate:
              data.article.publishDate || data.article.publishedAt || "",
            html: html, // 保留两种格式
            markdown: markdown,
          });
          // 设置初始内容
          // if (contentRef.current && data.article.content) {
          //   contentRef.current.innerHTML = data.article.content;
          // }
        } else if (data.type === "LOAD_DRAFT") {
          loadDraft();
        } else if (data.type === "PLATFORMS_DATA") {
          setPlatforms(data.platforms);
          // 使用传递的已选中平台，如果没有则从 storage 读取
          if (data.selectedPlatformIds && data.selectedPlatformIds.length > 0) {
            setSelectedPlatforms(new Set(data.selectedPlatformIds));
            saveSelectedPlatforms(data.selectedPlatformIds);
          } else {
            // 从 storage 读取上次选中的平台
            chrome.storage.local
              .get(SELECTED_PLATFORMS_KEY)
              .then((result) => {
                const storedPlatforms = result[SELECTED_PLATFORMS_KEY] as
                  | string[]
                  | undefined;
                const authenticated = getAuthenticatedPlatforms(data.platforms);
                const authenticatedIds = authenticated.map(
                  (p: Platform) => p.id,
                );
                const authenticatedSet = new Set(authenticatedIds);

                let selected: string[];
                if (storedPlatforms && storedPlatforms.length > 0) {
                  // 过滤掉未登录的平台
                  selected = storedPlatforms.filter((id) =>
                    authenticatedSet.has(id),
                  );
                } else {
                  // 默认选中所有已登录平台
                  selected = authenticatedIds;
                }

                if (selected.length === 0) {
                  // 如果过滤后为空，选中所有已登录平台
                  selected = authenticatedIds;
                }

                setSelectedPlatforms(new Set(selected));
              })
              .catch((e) => {
                logger.error("Failed to load selected platforms:", e);
                // 失败时默认选中所有已登录平台
                const authenticated = getAuthenticatedPlatforms(data.platforms);
                setSelectedPlatforms(
                  new Set(authenticated.map((p: Platform) => p.id)),
                );
              });
          }
        } else if (data.type === "SYNC_PROGRESS") {
          if (data.result) {
            setResults((prev) => [...prev, data.result]);
          }
        } else if (data.type === "SYNC_DETAIL_PROGRESS") {
          // 更新平台详细进度
          const progress = data.progress;
          if (progress?.platform) {
            setPlatformProgress((prev) => {
              const next = new Map(prev);
              next.set(progress.platform, progress);
              return next;
            });
          }
        } else if (data.type === "SYNC_COMPLETE") {
          setStatus("completed");
          // 显示频率限制警告（如果有）
          if (data.rateLimitWarning) {
            setRateLimitWarning(data.rateLimitWarning);
            // 8秒后自动关闭
            setTimeout(() => setRateLimitWarning(null), 8000);
          }
        } else if (data.type === "SYNC_ERROR") {
          setError(data.error);
          setStatus("idle");
        }
      } catch (e) {
        logger.error("Failed to parse message:", e);
      }
    };

    window.addEventListener("message", handleMessage);

    // 通知父窗口已准备好
    window.parent.postMessage(JSON.stringify({ type: "EDITOR_READY" }), "*");

    // 尝试加载草稿
    loadDraft();

    // 检测是否有父页面
    const hasParentPage = window.parent !== window;

    // 不再支持独立模式获取平台数据
    if (!hasParentPage) {
      logger.info("独立模式：平台数据将由父页面提供");
    } else {
      logger.info("有父页面模式：等待父页面发送数据");
    }

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // 加载草稿
  const loadDraft = async () => {
    try {
      const result = await chrome.storage.local.get([
        "draftArticle",
        "lastSaved",
      ]);
      if (result.draftArticle) {
        const draft = result.draftArticle;
        const lastSaved = result.lastSaved
          ? new Date(result.lastSaved).toLocaleString()
          : "未知";

        if (
          confirm(`检测到上次编辑的草稿 (保存时间: ${lastSaved})，是否加载？`)
        ) {
          const normalizedDraft: Article = {
            title: draft.title || "",
            author: draft.author || "",
            summary: draft.summary || "",
            content: draft.content || "",
            cover: draft.cover || "",
            url: draft.url || "",
            tags: Array.isArray(draft.tags) ? draft.tags : [],
            category: draft.category || "",
            articleType: draft.articleType || "",
            publishDate: draft.publishDate || draft.publishedAt || "",
          };
          setArticle(normalizedDraft);
        }
      }
    } catch (e) {
      logger.error("Failed to load draft:", e);
    }
  };

  // 切换平台选中状态
  const togglePlatform = (id: string) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      // 保存到 storage，与 popup 同步
      saveSelectedPlatforms(Array.from(next));
      return next;
    });
  };

  // 关闭编辑器
  const handleClose = useCallback(() => {
    window.parent.postMessage(JSON.stringify({ type: "CLOSE_EDITOR" }), "*");
  }, []);
  // 开始同步
  const handleSync = () => {
    if (!article || selectedPlatforms.size === 0) return;

    // 确保 article.content 就是当前编辑器显示的内容
    // 如果当前是 MD 模式，但 article.content 存的是 HTML，需要临时转换？不，切换模式时我们已经更新了 article.content
    // 但为了避免用户未切换模式直接同步，仍需保证一致性
    let finalHtml: string;
    let finalMarkdown: string;

    if (isMDMode) {
      // 当前显示 Markdown，从 textarea 获取最新值（可能未触发 onUpdate）
      const currentMd = mdContentRef.current?.value ?? article.content;
      finalMarkdown = currentMd;
      finalHtml = markdownToHtml(currentMd);
    } else {
      // 当前显示 HTML，从 TipTap 获取最新值
      const currentHtml = tiptapEditor?.getHTML() ?? article.content;
      finalHtml = currentHtml;
      finalMarkdown = htmlToMarkdownNative(currentHtml);
    }

    const editedArticle = {
      ...article,
      title: titleRef.current?.innerText || article.title,
      content: isMDMode ? finalMarkdown : finalHtml, // 保存当前模式对应的格式
      html: finalHtml,
      markdown: finalMarkdown,
    };

    // 生成 syncId（在发送消息前设置，以便立即过滤消息）
    const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setCurrentSyncId(syncId);

    setStatus("syncing");
    setResults([]);
    setError(null);
    setPlatformProgress(new Map());

    // 发送同步请求到父窗口（带上 syncId）
    window.parent.postMessage(
      JSON.stringify({
        type: "START_SYNC",
        article: editedArticle,
        platforms: Array.from(selectedPlatforms),
        syncId,
      }),
      "*",
    );
  };

  // 重试失败项
  const handleRetry = () => {
    const failedPlatforms = results
      .filter((r) => !r.success)
      .map((r) => r.platform);
    if (failedPlatforms.length === 0) return;

    const editedTitle = isMDMode
      ? article!.title
      : titleRef.current?.innerText || article!.title;
    const editedContent = isMDMode
      ? (mdContentRef.current?.value ?? article!.content)
      : (richContentRef.current?.innerHTML ?? article!.content);

    const editedArticle = {
      ...article!,
      title: editedTitle,
      content: editedContent,
    };

    // 生成新的 syncId
    const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setCurrentSyncId(syncId);

    setStatus("syncing");
    setResults((prev) => prev.filter((r) => r.success));
    setPlatformProgress(new Map()); // 清空进度

    window.parent.postMessage(
      JSON.stringify({
        type: "START_SYNC",
        article: editedArticle,
        platforms: failedPlatforms,
        syncId,
      }),
      "*",
    );
  };

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log("上传封面");
    const file = e.target.files?.[0];
    if (!file || !article) return;

    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        setArticle({ ...article, cover: reader.result as string });
      };
      reader.readAsDataURL(file);
      // 这里可以添加上传到图片的逻辑
    } catch (error) {
      logger.error("Failed to upload cover:", error);
      setError("封面上传失败");
    }
  };

  const authenticatedPlatforms = platforms.filter((p) => p.isAuthenticated);
  const successCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;

  if (!article) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto" />
          <p className="mt-2 text-gray-500">加载文章中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 mb-8">
      {/* 顶部工具栏 */}
      <header className="fixed top-0 left-0 right-0 bg-white border-b shadow-sm z-50">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img
              src={chrome.runtime.getURL("assets/icon-48.png")}
              alt="Logo"
              className="w-6 h-6"
            />
            <span className="font-medium text-gray-700">
              同步助手 - 编辑模式
            </span>

            {/* 编辑器模式切换 */}
            <div className="flex items-center gap-2 ml-4 border-l pl-4">
              <button
                onClick={() => switchEditorMode(false)}
                className={cn(
                  "px-3 py-1 rounded text-sm transition-colors",
                  !isMDMode
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                )}
              >
                富文本
              </button>
              <button
                onClick={() => switchEditorMode(true)}
                className={cn(
                  "px-3 py-1 rounded text-sm transition-colors",
                  isMDMode
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                )}
              >
                Markdown
              </button>
            </div>

            {/* 预览切换（仅 MD 模式） */}
            {isMDMode && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditorMode("edit")}
                  className={cn(
                    "p-2 rounded transition-colors",
                    editorMode === "edit"
                      ? "bg-blue-100 text-blue-600"
                      : "text-gray-500 hover:bg-gray-100",
                  )}
                  title="编辑模式"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setEditorMode("preview")}
                  className={cn(
                    "p-2 rounded transition-colors",
                    editorMode === "preview"
                      ? "bg-blue-100 text-blue-600"
                      : "text-gray-500 hover:bg-gray-100",
                  )}
                  title="预览模式"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* 同步按钮 */}
          <div className="flex items-center gap-2">
            {status === "idle" && (
              <button
                onClick={handleSync}
                disabled={selectedPlatforms.size === 0}
                className={cn(
                  "px-4 py-2 rounded-lg font-medium transition-colors",
                  selectedPlatforms.size > 0
                    ? "bg-blue-500 text-white hover:bg-blue-600"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed",
                )}
              >
                同步到 {selectedPlatforms.size} 个平台
              </button>
            )}

            {status === "syncing" && (
              <div className="flex items-center gap-2">
                <span className="px-4 py-2 rounded-lg bg-blue-400 text-white flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  同步中 {results.length}/{selectedPlatforms.size}
                </span>
                <button
                  onClick={() => {
                    setStatus("idle");
                    setResults([]);
                    setError(null);
                  }}
                  className="px-3 py-2 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors text-sm"
                >
                  取消
                </button>
              </div>
            )}

            {status === "completed" && (
              <div className="flex items-center gap-2">
                {failedCount > 0 && (
                  <button
                    onClick={handleRetry}
                    className="px-4 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600"
                  >
                    重试失败 ({failedCount})
                  </button>
                )}
                <span className="text-sm text-gray-500">
                  {successCount} 成功 / {failedCount} 失败
                </span>
                <button
                  onClick={() => {
                    setStatus("idle");
                    setResults([]);
                    setPlatformProgress(new Map());
                    setCurrentSyncId(null);
                  }}
                  className="px-4 py-2 rounded-lg bg-purple-500 text-white hover:bg-purple-600"
                >
                  完成
                </button>
              </div>
            )}

            <button
              onClick={handleClose}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              title="关闭"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>
        {/* 平台选择栏 */}
        <div className="px-6 py-2 border-t bg-gray-50 flex items-center gap-2 overflow-x-auto">
          <span className="text-sm text-gray-500 flex-shrink-0">选择平台:</span>
          <div className="flex items-center gap-1 flex-shrink-0 mr-2">
            <button
              onClick={() => {
                const allIds = authenticatedPlatforms.map((p) => p.id);
                setSelectedPlatforms(new Set(allIds));
                saveSelectedPlatforms(allIds);
              }}
              disabled={status === "syncing"}
              className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-50"
            >
              全选
            </button>
            <button
              onClick={() => {
                setSelectedPlatforms(new Set());
                saveSelectedPlatforms([]);
              }}
              disabled={status === "syncing"}
              className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-50"
            >
              全不选
            </button>
          </div>
          {authenticatedPlatforms.map((platform) => {
            const isSelected = selectedPlatforms.has(platform.id);
            const result = results.find((r) => r.platform === platform.id);
            return (
              <button
                key={platform.id}
                onClick={() => togglePlatform(platform.id)}
                disabled={status === "syncing"}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all flex-shrink-0",
                  isSelected
                    ? "bg-blue-100 text-blue-700 border-2 border-blue-300"
                    : "bg-white text-gray-600 border border-gray-200 hover:border-gray-300",
                  status === "syncing" && "opacity-50 cursor-not-allowed",
                )}
              >
                <img src={platform.icon} alt="" className="w-4 h-4 rounded" />
                <span>{platform.name}</span>
                {result &&
                  (result.success ? (
                    <Check className="w-3 h-3 text-green-500" />
                  ) : (
                    <X className="w-3 h-3 text-red-500" />
                  ))}
              </button>
            );
          })}
        </div>
        {/* 工具栏（同时支持富文本和Markdown模式） */}
        <div className="px-6 py-1 bg-gray-50 border-t flex items-center gap-1 overflow-x-auto">
          {/* 基础格式 */}
          <button
            onClick={() => {
              if (isMDMode) {
                insertMarkdownFormat("**", "**");
              } else if (tiptapEditor) {
                tiptapEditor.commands.toggleBold();
              }
            }}
            className="p-1.5 rounded hover:bg-gray-200 text-sm"
            title="加粗"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (isMDMode) {
                insertMarkdownFormat("*", "*");
              } else if (tiptapEditor) {
                tiptapEditor.commands.toggleItalic();
              }
            }}
            className="p-1.5 rounded hover:bg-gray-200 text-sm"
            title="斜体"
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (isMDMode) {
                insertMarkdownFormat("<u>", "</u>");
              } else if (tiptapEditor) {
                tiptapEditor.commands.toggleUnderline();
              }
            }}
            className="p-1.5 rounded hover:bg-gray-200 text-sm"
            title="下划线"
          >
            <Underline className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (isMDMode) {
                insertMarkdownFormat("~~", "~~");
              } else if (tiptapEditor) {
                tiptapEditor.commands.toggleStrike();
              }
            }}
            className="p-1.5 rounded hover:bg-gray-200 text-sm"
            title="删除线"
          >
            <Strikethrough className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-gray-300 mx-1" />

          {/* 标题 */}
          <select
            onChange={(e) => {
              const value = e.target.value;
              if (isMDMode) {
                if (value === "<p>") {
                  // 正文
                } else {
                  const level = parseInt(
                    value.replace("<h", "").replace(">", "") || "1",
                  );
                  insertMarkdownHeader(level);
                }
              } else if (tiptapEditor) {
                if (value === "<p>") {
                  tiptapEditor.commands.clearInclusiveMarks();
                } else {
                  const level = parseInt(
                    value.replace("<h", "").replace(">", "") || "1",
                  );
                  tiptapEditor.commands.setHeading({ level });
                }
              }
            }}
            className="p-1 rounded border border-gray-200 bg-white text-sm focus:outline-none"
            title="标题级别"
          >
            <option value="<p>">正文</option>
            <option value="<h1>">标题1</option>
            <option value="<h2>">标题2</option>
            <option value="<h3>">标题3</option>
            <option value="<h4>">标题4</option>
            <option value="<h5>">标题5</option>
            <option value="<h6>">标题6</option>
          </select>
          <div className="w-px h-4 bg-gray-300 mx-1" />

          {/* 列表 */}
          <button
            onClick={() => {
              if (isMDMode) {
                insertMarkdownList("- ");
              } else if (tiptapEditor) {
                tiptapEditor.commands.toggleBulletList();
              }
            }}
            className="p-1.5 rounded hover:bg-gray-200 text-sm"
            title="无序列表"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (isMDMode) {
                insertMarkdownList("1. ");
              } else if (tiptapEditor) {
                tiptapEditor.commands.toggleOrderedList();
              }
            }}
            className="p-1.5 rounded hover:bg-gray-200 text-sm"
            title="有序列表"
          >
            <ListOrdered className="w-4 h-4" />
          </button>
          <button
            onClick={() =>
              isMDMode
                ? insertMarkdownIndent(true)
                : tiptapEditor
                    ?.chain()
                    .focus()
                    .updateAttributes("paragraph", {
                      style: "margin-left: 2em",
                    })
                    .run()
            }
            className="p-1.5 rounded hover:bg-gray-200 text-sm"
            title="增加缩进"
          >
            →
          </button>
          <button
            onClick={() =>
              isMDMode
                ? insertMarkdownIndent(false)
                : tiptapEditor
                    ?.chain()
                    .focus()
                    .updateAttributes("paragraph", { style: "margin-left: 0" })
                    .run()
            }
            className="p-1.5 rounded hover:bg-gray-200 text-sm"
            title="减少缩进"
          >
            ←
          </button>
          <div className="w-px h-4 bg-gray-300 mx-1" />

          {/* 插入内容 */}
          <button
            onClick={() => insertLink()}
            className="p-1.5 rounded hover:bg-gray-200 text-sm"
            title="插入链接"
          >
            <Link className="w-4 h-4" />
          </button>
          <button
            ref={buttonRef}
            onClick={toggleMenu}
            className="p-1.5 rounded hover:bg-gray-200 text-sm"
            title="插入图片"
          >
            <Image className="w-4 h-4" />
          </button>
          {showImageMenu && imageMenuPos && (
            <Dropdown position={imageMenuPos}>
              <button
                onClick={insertImageByUrl}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
              >
                添加图片链接
              </button>
              <button
                onClick={uploadImage}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
              >
                上传图片
              </button>
            </Dropdown>
          )}
          <button
            onClick={() =>
              isMDMode
                ? insertMarkdownCode()
                : tiptapEditor?.commands.setCodeBlock()
            }
            className="p-1.5 rounded hover:bg-gray-200 text-sm"
            title="代码框"
          >
            &lt;/&gt;
          </button>
          <button
            onClick={() =>
              isMDMode
                ? insertMarkdownHorizontalRule()
                : tiptapEditor?.commands.insertContent("<hr />")
            }
            className="p-1.5 rounded hover:bg-gray-200 text-sm"
            title="分隔线"
          >
            ━
          </button>
          <div className="w-px h-4 bg-gray-300 mx-1" />

          {/* AI 润色正文按钮 */}
          <button
            onClick={async () => {
              const configured = await checkConfigured();
              if (!configured) {
                setError("请先在设置中配置 AI（API 地址和 Key）");
                return;
              }
              const currentContent = isMDMode
                ? (mdContentRef.current?.value ?? article.content)
                : (tiptapEditor?.getHTML() ?? article.content);
              if (!currentContent || currentContent.length < 10) {
                setError("文章正文内容太少，无法进行 AI 润色");
                return;
              }
              const polished = await polishContent(currentContent);
              if (polished && polished !== currentContent) {
                updateArticle("content", polished);
                // 同步更新编辑器
                if (isMDMode && mdContentRef.current) {
                  mdContentRef.current.value = polished;
                } else if (!isMDMode && tiptapEditor) {
                  tiptapEditor.commands.setContent(polished);
                }
              }
            }}
            disabled={aiLoading === "content"}
            className={cn(
              "px-2.5 py-1.5 rounded text-sm transition-colors flex items-center gap-1.5",
              aiLoading === "content"
                ? "bg-purple-100 text-purple-400 cursor-not-allowed"
                : "bg-purple-50 text-purple-600 hover:bg-purple-100 border border-purple-200"
            )}
            title="AI 润色正文"
          >
            {aiLoading === "content" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            AI 润色
          </button>
        </div>
      </header>

      {/* AI 操作加载提示 */}
      {aiLoading && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 shadow-lg flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-purple-500 flex-shrink-0" />
            <p className="text-sm text-purple-700">
              {aiLoading === "title" && "AI 正在生成标题..."}
              {aiLoading === "content" && "AI 正在润色正文..."}
              {aiLoading === "summary" && "AI 正在生成摘要..."}
              {aiLoading === "tags" && "AI 正在推荐标签..."}
            </p>
          </div>
        </div>
      )}

      {/* 频率限制警告 */}
      {rateLimitWarning && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 shadow-lg flex items-center gap-2 max-w-md">
            <span className="text-lg flex-shrink-0">⚠️</span>
            <p className="text-sm text-yellow-800 flex-1">{rateLimitWarning}</p>
            <button
              onClick={() => setRateLimitWarning(null)}
              className="text-yellow-600 hover:text-yellow-800 flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 文章编辑区 */}
      <main className="mb-8 pt-32 px-6 bg-gray-50 min-h-screen">
        <div className="w-full max-w-4xl mx-auto bg-white rounded-lg p-12 shadow-none">
          {/* 标题区域 */}
          <div className="text-left">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <div
                  ref={titleRef}
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) =>
                    updateArticle("title", e.currentTarget.innerText.trim())
                  }
                  className="w-full text-4xl font-bold text-gray-800 outline-none leading-tight border-b border-gray-100 placeholder-gray-400"
                  style={{ minHeight: "4rem", lineHeight: 1.4 }}
                  data-placeholder="请输入文章标题（最多64个字）"
                >
                  {article.title || (
                    <span className="text-gray-300">
                      请输入文章标题（最多64个字）
                    </span>
                  )}
                </div>
                {/* 标题字数提示 */}
                <div className="text-right text-xs text-gray-400 mt-1">
                  {article.title.length}/64
                </div>
              </div>
              {/* AI 润色标题按钮 */}
              <button
                onClick={async () => {
                  const configured = await checkConfigured();
                  if (!configured) {
                    setError("请先在设置中配置 AI（API 地址和 Key）");
                    return;
                  }
                  const currentContent = isMDMode
                    ? (mdContentRef.current?.value ?? article.content)
                    : (tiptapEditor?.getHTML() ?? article.content);
                  const titles = await polishTitle(article.title, undefined, currentContent);
                  if (titles.length > 1 || titles[0] !== article.title) {
                    setTitleSuggestions(titles);
                    setSelectedTitleIndex(0);
                    setShowTitlePanel(true);
                  }
                }}
                disabled={aiLoading === "title"}
                className={cn(
                  "flex-shrink-0 mt-1 px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-1.5",
                  aiLoading === "title"
                    ? "bg-purple-100 text-purple-400 cursor-not-allowed"
                    : "bg-purple-50 text-purple-600 hover:bg-purple-100 border border-purple-200"
                )}
                title="AI 润色标题"
              >
                {aiLoading === "title" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                AI 润色标题
              </button>
            </div>

            {/* AI 标题建议面板 */}
            {showTitlePanel && titleSuggestions.length > 0 && (
              <div className="mt-3 p-3 bg-purple-50 rounded-lg border border-purple-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-purple-700 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    AI 建议标题
                  </span>
                  <button
                    onClick={() => setShowTitlePanel(false)}
                    className="text-purple-400 hover:text-purple-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-1.5">
                  {titleSuggestions.map((t, i) => (
                    <div
                      key={i}
                      onClick={() => {
                        setSelectedTitleIndex(i);
                        updateArticle("title", t);
                        if (titleRef.current) {
                          titleRef.current.innerText = t;
                        }
                        setShowTitlePanel(false);
                      }}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded text-sm cursor-pointer transition-colors",
                        i === selectedTitleIndex
                          ? "bg-purple-200 text-purple-900"
                          : "bg-white text-gray-700 hover:bg-purple-100"
                      )}
                    >
                      <span className="text-xs text-purple-400 font-medium w-5 text-center">
                        {i + 1}
                      </span>
                      <span className="flex-1">{t}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 作者/编辑信息栏 */}
          <div className="mb-5">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">作者：</span>
              <div
                ref={authorRef}
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) =>
                  updateArticle("author", e.currentTarget.innerText.trim())
                }
                className="text-sm text-gray-800 outline-none min-w-[100px] placeholder-gray-400"
                data-placeholder="请输入作者名"
              >
                {article.author || (
                  <span className="text-gray-500">请输入作者名</span>
                )}
              </div>
            </div>
          </div>

          {/* 内容区域 */}
          <div className="mb-2">
            {isMDMode ? (
              // Markdown 模式
              <div className="rounded-lg overflow-hidden bg-white">
                {/* 编辑/预览区域 */}
                {editorMode === "edit" ? (
                  <textarea
                    ref={mdContentRef}
                    value={article.content}
                    onChange={(e) => updateArticle("content", e.target.value)}
                    placeholder="请在这里编写文章内容（支持Markdown语法）..."
                    className="w-full outline-none font-sans text-base bg-white p-4"
                    style={{
                      lineHeight: 1.8,
                      minHeight: "900px",
                      color: "#333",
                      fontSize: "16px",
                      fontFamily:
                        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
                      resize: "vertical",
                      overflow: "auto",
                    }}
                  />
                ) : (
                  <div
                    ref={previewRef}
                    className="prose max-w-none min-h-[800px] bg-white prose-headings:font-bold prose-h1:text-4xl prose-h2:text-3xl prose-h3:text-2xl prose-h4:text-1xl prose-h5:text-1 prose-h6:text-1 p-4"
                    style={{
                      lineHeight: 1.8,
                      fontSize: "16px",
                    }}
                  >
                    {renderMarkdown(article.content)}
                  </div>
                )}
              </div>
            ) : (
              // 富文本模式 - 使用 TipTap 编辑器
              <TipTapEditor
                article={article}
                onChange={(content) => updateArticle("content", content)}
                onEditorReady={setTiptapEditor}
              />
            )}
          </div>
        </div>
      </main>

      {/* 同步进度浮窗 */}
      {(status === "syncing" || results.length > 0) && (
        <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg border p-4 w-80 max-h-80 overflow-y-auto z-50">
          <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
            {status === "syncing" && (
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            )}
            {status === "syncing" ? "同步中" : "同步结果"}
            <span className="text-sm font-normal text-gray-500">
              {results.length}/{selectedPlatforms.size}
            </span>
          </h3>
          <div className="space-y-2">
            {Array.from(selectedPlatforms).map((platformId) => {
              const platform = platforms.find((p) => p.id === platformId);
              const result = results.find((r) => r.platform === platformId);
              const progress = platformProgress.get(platformId);

              const getStageText = (p: PlatformProgress) => {
                switch (p.stage) {
                  case "starting":
                    return "准备中...";
                  case "uploading_images":
                    return p.imageProgress
                      ? `上传图片 ${p.imageProgress.current}/${p.imageProgress.total}`
                      : "上传图片...";
                  case "saving":
                    return "保存文章...";
                  case "completed":
                    return "完成";
                  case "failed":
                    return p.error || "失败";
                  default:
                    return "等待中";
                }
              };

              if (result) {
                return (
                  <div
                    key={platformId}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="flex items-center gap-2">
                      {result.success ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <X className="w-4 h-4 text-red-500" />
                      )}
                      {platform?.name || platformId}
                    </span>
                    {result.success && result.postUrl && (
                      <a
                        href={result.postUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline flex items-center gap-1"
                      >
                        查看 <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {!result.success && result.error && (
                      <span
                        className="text-red-500 truncate max-w-[120px]"
                        title={result.error}
                      >
                        {result.error}
                      </span>
                    )}
                  </div>
                );
              }

              if (progress) {
                return (
                  <div
                    key={platformId}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                      {platform?.name || platformId}
                    </span>
                    <span className="text-blue-600 text-xs">
                      {getStageText(progress)}
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={platformId}
                  className="flex items-center justify-between text-sm text-gray-400"
                >
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full border border-gray-300" />
                    {platform?.name || platformId}
                  </span>
                  <span className="text-xs">等待中</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="fixed bottom-4 left-4 bg-red-50 border border-red-200 rounded-lg p-4 max-w-sm z-50">
          <p className="text-red-700 text-sm">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-2 text-red-500 hover:underline text-sm"
          >
            关闭
          </button>
        </div>
      )}

      {/* 文章基本信息 */}
      <div className=" border-t py-8 bg-gray-50 ">
        <div className="pb-16 max-w-4xl mx-auto bg-white rounded-lg p-12 show-nonw">
          {/* 封面部分（对标CSDN/公众号，移到元信息区域顶部） */}
          <div className="mb-6">
            <label className="block text-gray-700 font-normal mb-2 text-base">
              文章封面{" "}
              <span className="text-base text-gray-400">
                (推荐尺寸: 1200x630，会显示在文章列表)
              </span>
            </label>
            <div className="flex items-start gap-4">
              {/* 封面上传区域 */}
              <div className="relative border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-300 transition-colors w-40 h-28 flex items-center justify-center">
                {article.cover ? (
                  <div className="relative w-full h-full group">
                    <img
                      src={article.cover}
                      alt="封面预览"
                      className="w-full h-full object-cover rounded-lg"
                    />
                    <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100 rounded-lg">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="bg-white text-gray-700 px-2 py-1 rounded text-xs shadow-sm hover:bg-gray-50 mr-1"
                      >
                        更换
                      </button>
                      <button
                        onClick={() => updateArticle("cover", "")}
                        className="bg-red-500 text-white px-2 py-1 rounded text-xs shadow-sm hover:bg-red-600"
                      >
                        移除
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-full flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <svg
                      className="w-8 h-8 mb-1"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    <span className="text-xs">上传封面</span>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleCoverUpload}
                  className="hidden"
                />
              </div>

              {/* 封面提示 */}
              <div className="flex-1 text-sm text-gray-500">
                <p>• 封面图会显示在文章列表和分享卡片中</p>
                <p>• 推荐使用 1200x630 像素的图片，效果最佳</p>
                <p>• 支持 JPG、PNG 格式，大小不超过 5MB</p>
              </div>
            </div>
          </div>

          {/* 文章摘要模块 */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <label className="text-gray-700 font-normal text-base">
                文章摘要
              </label>
              <button
                onClick={async () => {
                  const configured = await checkConfigured();
                  if (!configured) {
                    setError("请先在设置中配置 AI（API 地址和 Key）");
                    return;
                  }
                  const currentContent = isMDMode
                    ? (mdContentRef.current?.value ?? article.content)
                    : (tiptapEditor?.getHTML() ?? article.content);
                  const summary = await generateSummary(currentContent, 256);
                  if (summary) {
                    updateArticle("summary", summary);
                  }
                }}
                disabled={aiLoading === "summary"}
                className={cn(
                  "px-2.5 py-1 rounded text-xs transition-colors flex items-center gap-1",
                  aiLoading === "summary"
                    ? "bg-purple-100 text-purple-400 cursor-not-allowed"
                    : "bg-purple-50 text-purple-500 hover:bg-purple-100 border border-purple-200"
                )}
                title="AI 生成摘要"
              >
                {aiLoading === "summary" ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
                AI 生成
              </button>
            </div>
            <div className="flex flex-col gap-1">
              <textarea
                value={article.summary || ""}
                onChange={(e) => {
                  // 限制最大输入 256 字
                  const value = e.target.value.slice(0, 256);
                  updateArticle("summary", value);
                }}
                placeholder="摘要：会在推、列表等场景外露，帮助读者快速了解内容，支持一键将正文前 256 字符键入摘要框"
                className="px-3 py-2 border border-gray-200 rounded focus:outline-none focus:border-blue-300 resize-none text-sm"
                rows={3}
              />
              <div
                className="text-right text-gray-400"
                style={{ fontSize: "15px" }}
              >
                {article.summary ? article.summary.length : 0}/256
              </div>
            </div>
          </div>

          {/* 第一行：标签 + 分类专栏（对标CSDN） */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* 文章标签 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-gray-700 font-normal text-base">
                  文章标签{" "}
                  <span className="text-base text-gray-400">
                    (多个标签用逗号分隔)
                  </span>
                </label>
                <button
                  onClick={async () => {
                    const configured = await checkConfigured();
                    if (!configured) {
                      setError("请先在设置中配置 AI（API 地址和 Key）");
                      return;
                    }
                    const currentContent = isMDMode
                      ? (mdContentRef.current?.value ?? article.content)
                      : (tiptapEditor?.getHTML() ?? article.content);
                    const tags = await suggestTags(currentContent);
                    if (tags.length > 0) {
                      updateArticle("tags", [
                        ...(article.tags || []),
                        ...tags.filter(
                          (t) => !(article.tags || []).includes(t)
                        ),
                      ]);
                    }
                  }}
                  disabled={aiLoading === "tags"}
                  className={cn(
                    "px-2.5 py-1 rounded text-xs transition-colors flex items-center gap-1",
                    aiLoading === "tags"
                      ? "bg-purple-100 text-purple-400 cursor-not-allowed"
                      : "bg-purple-50 text-purple-500 hover:bg-purple-100 border border-purple-200"
                  )}
                  title="AI 推荐标签"
                >
                  {aiLoading === "tags" ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  AI 推荐
                </button>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                {/* 已选标签展示（对标CSDN标签样式） */}
                {article.tags && article.tags.length > 0 ? (
                  article.tags.map((tag, index) => (
                    <div
                      key={index}
                      className="flex items-center bg-blue-50 text-blue-700 px-2 py-1 rounded-full text-sm"
                    >
                      <span>{tag}</span>
                      <button
                        onClick={() => {
                          if (article.tags && article.tags.length > 0) {
                            updateArticle(
                              "tags",
                              article.tags.filter((_, i) => i !== index),
                            );
                          }
                        }}
                        className="ml-1 text-blue-500 hover:text-blue-700"
                      >
                        ×
                      </button>
                    </div>
                  ))
                ) : (
                  <span className="text-gray-400 text-sm">未添加标签</span>
                )}
                {/* 添加标签输入框 */}
                <input
                  type="text"
                  placeholder="输入标签后回车添加"
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Enter" && e.currentTarget.value.trim()) {
                      updateArticle("tags", [
                        ...(article.tags || []),
                        e.currentTarget.value.trim(),
                      ]);
                      e.currentTarget.value = "";
                    }
                  }}
                  className="px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:border-blue-300"
                />
              </div>
            </div>

            {/* 分类专栏（对标CSDN） */}
            <div>
              <label className="block text-gray-700 font-normal mb-2 text-base">
                分类专栏
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={article.category || ""}
                  onChange={(e) => updateArticle("category", e.target.value)}
                  className="px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:border-blue-300"
                >
                  <option value="">未选择专栏</option>
                  <option value="技术">技术</option>
                  <option value="前端">前端</option>
                  <option value="后端">后端</option>
                  <option value="人工智能">人工智能</option>
                </select>
                <button
                  onClick={() => {
                    const newCategory = prompt("输入新专栏名称:");
                    if (newCategory) updateArticle("category", newCategory);
                  }}
                  className="px-2 py-1 border border-gray-200 rounded text-sm bg-gray-50 hover:bg-gray-100"
                >
                  + 新建专栏
                </button>
              </div>
            </div>
          </div>

          {/* 原创声明  */}
          <div className="mb-6">
            {/* 文章类型（原创/转载） */}
            <div className="mb-4">
              <label className="block text-gray-700 font-normal mb-2 text-base">
                文章类型
              </label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="articleType"
                    value="original"
                    checked={article.articleType === "original"}
                    onChange={() => updateArticle("articleType", "original")}
                    className="cursor-pointer h-4 w-4"
                  />
                  <span
                    className={`text-base ${
                      article.articleType === "original"
                        ? "font-bold text-gray-800"
                        : "text-gray-400"
                    }`}
                  >
                    原创
                  </span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="articleType"
                    value="reprint"
                    checked={article.articleType === "reprint"}
                    onChange={() => updateArticle("articleType", "reprint")}
                    className="cursor-pointer h-4 w-4"
                  />
                  <span
                    className={`text-base ${
                      article.articleType === "reprint"
                        ? "font-bold text-gray-800"
                        : "text-gray-400"
                    }`}
                  >
                    转载
                  </span>
                </label>
              </div>
            </div>

            {/* 转载链接 */}
            {article.articleType === "reprint" && (
              <div>
                <input
                  type="text"
                  value={article.url || ""}
                  onChange={(e) => updateArticle("url", e.target.value)}
                  placeholder="请输入原文链接"
                  className="w-1/2 px-3 py-2 border border-gray-200 rounded focus:outline-none focus:border-blue-300 text-sm"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
