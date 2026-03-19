import { useState, useRef, useEffect, useCallback } from "react";
import { X, Check, Loader2, ExternalLink, Edit2, Eye } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { cn } from "@/lib/utils";
import { createLogger } from "../lib/logger";
import { useDebounce } from "use-debounce";
const logger = createLogger("Editor");

interface Article {
  title: string;
  author?: string;
  summary?: string;
  content: string;
  cover?: string;
  url?: string;
  tags?: string[];
  category?: string;
  publishDate?: string;
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

  const [debouncedArticle] = useDebounce(article, 1000);

  const mdContentRef = useRef<HTMLTextAreaElement>(null);
  const richContentRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const updateArticle = useCallback(
    <K extends keyof Article>(key: K, value: Article[K]) => {
      setArticle((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    [],
  );

  const renderMarkdown = useCallback((content: string) => {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          img: ({ ...props }) => (
            <img
              {...props}
              className="max-w-full h-auto my-4 rounded-lg shadow-md"
            />
          ),
          a: ({ ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            />
          ),
          code: ({
            inline,
            ...props
          }: {
            inline?: boolean;
            [key: string]: any;
          }) =>
            inline ? (
              <code
                {...props}
                className="bg-gray-100 px-1 py-0.5 rounded text-sm"
              />
            ) : (
              <pre className="bg-gray-800 text-white p-4 rounded-lg overflow-x-auto my-4">
                <code {...props} />
              </pre>
            ),
        }}
      >
        {content}
      </ReactMarkdown>
    );
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
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  const tagsRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const publishDateRef = useRef<HTMLInputElement>(null);
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
          setArticle({
            title: data.article.title || "",
            author: data.article.author || "",
            summary: data.article.summary || "",
            content: data.article.content || "",
            cover: data.article.cover || "",
            tags: data.article.tags || [],
            category: data.article.category || "",
            publishDate: data.article.publishedAt || "",
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
                const authenticated = data.platforms.filter(
                  (p: Platform) => p.isAuthenticated,
                );
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
                const authenticated = data.platforms.filter(
                  (p: Platform) => p.isAuthenticated,
                );
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
            publishDate: draft.publishDate || draft.publishedAt || "",
          };
          setArticle(normalizedDraft);
        }
      }
    } catch (e) {
      logger.error("Failed to load draft:", e);
    }
  };

  //加载选中平台
  const loadSelectedPlatforms = async (platformsList: Platform[]) => {
    try {
      const result = await chrome.storage.local.get(SELECTED_PLATFORMS_KEY);
      const storedPlatforms = result[SELECTED_PLATFORMS_KEY] as
        | string[]
        | undefined;

      const authenticated = platformsList.filter((p) => p.isAuthenticated);
      const authenticatedIds = authenticated.map((p) => p.id);
      const authenticatedSet = new Set(authenticatedIds);

      let selected: string[];
      if (storedPlatforms && storedPlatforms.length > 0) {
        selected = storedPlatforms.filter((id) => authenticatedSet.has(id));
      } else {
        selected = authenticatedIds;
      }

      if (selected.length === 0) {
        selected = authenticatedIds;
      }

      setSelectedPlatforms(new Set(selected));
    } catch (e) {
      logger.error("Failed to load selected platforms:", e);
      const authenticated = platformsList.filter((p) => p.isAuthenticated);
      setSelectedPlatforms(new Set(authenticated.map((p) => p.id)));
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

    const editedTitle = isMDMode
      ? article.title
      : titleRef.current?.innerText || article.title;
    const editedContent = isMDMode
      ? (mdContentRef.current?.value ?? article.content)
      : (richContentRef.current?.innerHTML ?? article.content);

    const editedArticle = {
      ...article,
      title: editedTitle,
      content: editedContent,
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

  //上传封面
  const handleRemoveCover = () => {
    console.log("删除封面");
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
      // 这里可以添加上传到图床的逻辑
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
    <div className="min-h-screen bg-gray-50">
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
                onClick={() => setIsMDMode(false)}
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
                onClick={() => setIsMDMode(true)}
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
                  className="px-4 py-2 rounded-lg bg-green-500 text-white hover:bg-green-600"
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
      </header>

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
      <main className="pt-32 pb-16 px-6">
        <div className="w-full max-w-4xl mx-auto bg-white shadow-sm rounded-lg p-8">
          {/* 封面图区域 */}
          <div className="mb-8">
            <label className="block text-gray-700 font-medium mb-2">
              文章封面{" "}
              <span className="text-sm text-gray-400 font-normal">
                (推荐尺寸: 1200x630)
              </span>
            </label>
            <div className="relative border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 transition-colors">
              {article.cover ? (
                <div className="relative group">
                  <img
                    src={article.cover}
                    alt="封面预览"
                    className="w-full max-h-80 object-cover rounded-lg"
                  />
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="bg-white text-gray-700 px-4 py-2 rounded-lg shadow-lg hover:bg-gray-50 mr-2"
                    >
                      更换图片
                    </button>
                    <button
                      onClick={() => updateArticle("cover", "")}
                      className="bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg hover:bg-red-600"
                    >
                      移除
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-48 flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <svg
                    className="w-12 h-12 mb-2"
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
                  <span className="text-sm">点击上传封面图</span>
                  <span className="text-xs text-gray-300 mt-1">
                    支持 JPG、PNG、GIF
                  </span>
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
          </div>

          {/* 标题 */}
          <div className="mb-6">
            <label className="block text-gray-700 font-medium mb-2">
              标题 <span className="text-red-500">*</span>
            </label>
            <h1
              ref={titleRef}
              contentEditable={!isMDMode}
              suppressContentEditableWarning
              onBlur={(e) => updateArticle("title", e.currentTarget.innerText)}
              className={cn(
                "w-full text-3xl font-bold text-gray-900 outline-none rounded px-3 py-2 leading-tight",
                !isMDMode
                  ? "border focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                  : "bg-gray-50",
              )}
              style={{ minHeight: "3.5rem" }}
            >
              {article.title}
            </h1>
            {isMDMode && (
              <input
                type="text"
                value={article.title}
                onChange={(e) => updateArticle("title", e.target.value)}
                placeholder="输入文章标题"
                className="w-full text-3xl font-bold text-gray-900 outline-none rounded px-3 py-2 leading-tight border focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              />
            )}
          </div>

          {/* 作者 */}
          <div className="mb-6">
            <label className="block text-gray-700 font-medium mb-2">作者</label>
            <input
              ref={authorRef}
              type="text"
              value={article.author}
              onChange={(e) => updateArticle("author", e.target.value)}
              placeholder="输入作者名"
              className="w-full px-3 py-2 border rounded-lg focus:border-blue-300 focus:ring-2 focus:ring-blue-100 outline-none"
            />
          </div>

          {/* 摘要 */}
          <div className="mb-6">
            <label className="block text-gray-700 font-medium mb-2">
              摘要{" "}
              <span className="text-sm text-gray-400 font-normal">
                (选填，会显示在文章列表)
              </span>
            </label>
            <textarea
              ref={summaryRef}
              value={article.summary}
              onChange={(e) => updateArticle("summary", e.target.value)}
              placeholder="输入文章摘要..."
              rows={3}
              className="w-full px-3 py-2 border rounded-lg focus:border-blue-300 focus:ring-2 focus:ring-blue-100 outline-none resize-none"
            />
          </div>

          {/* 标签 */}
          <div className="mb-6">
            <label className="block text-gray-700 font-medium mb-2">标签</label>
            <input
              ref={tagsRef}
              type="text"
              value={article.tags?.join(", ")}
              onChange={(e) =>
                updateArticle(
                  "tags",
                  e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter((t) => t),
                )
              }
              placeholder="多个标签用逗号分隔"
              className="w-full px-3 py-2 border rounded-lg focus:border-blue-300 focus:ring-2 focus:ring-blue-100 outline-none"
            />
          </div>

          {/* 内容区域 */}
          <div className="mb-6">
            <label className="block text-gray-700 font-medium mb-2">
              内容 <span className="text-red-500">*</span>
            </label>

            {isMDMode ? (
              // Markdown 模式
              <div className="border rounded-lg overflow-hidden">
                {/* 工具栏 */}
                <div className="bg-gray-50 border-b px-3 py-2 flex items-center gap-2">
                  <button
                    onClick={() => {
                      const textarea = mdContentRef.current;
                      if (!textarea) return;
                      const start = textarea.selectionStart;
                      const end = textarea.selectionEnd;
                      const text = textarea.value;
                      const newText =
                        text.substring(0, start) +
                        "**" +
                        text.substring(start, end) +
                        "**" +
                        text.substring(end);
                      updateArticle("content", newText);
                      setTimeout(() => textarea.focus(), 0);
                    }}
                    className="p-1.5 rounded hover:bg-gray-200 text-sm font-bold"
                    title="加粗"
                  >
                    B
                  </button>
                  <button
                    onClick={() => {
                      const textarea = mdContentRef.current;
                      if (!textarea) return;
                      const start = textarea.selectionStart;
                      const end = textarea.selectionEnd;
                      const text = textarea.value;
                      const newText =
                        text.substring(0, start) +
                        "*" +
                        text.substring(start, end) +
                        "*" +
                        text.substring(end);
                      updateArticle("content", newText);
                    }}
                    className="p-1.5 rounded hover:bg-gray-200 text-sm italic"
                    title="斜体"
                  >
                    I
                  </button>
                  <button
                    onClick={() => {
                      const textarea = mdContentRef.current;
                      if (!textarea) return;
                      const start = textarea.selectionStart;
                      const end = textarea.selectionEnd;
                      const text = textarea.value;
                      const newText =
                        text.substring(0, start) +
                        "#" +
                        text.substring(start, end) +
                        text.substring(end);
                      updateArticle("content", newText);
                    }}
                    className="p-1.5 rounded hover:bg-gray-200 text-sm"
                    title="标题"
                  >
                    H1
                  </button>
                  <div className="w-px h-4 bg-gray-300 mx-1" />
                  <button
                    onClick={() =>
                      updateArticle("content", article.content + "\n- ")
                    }
                    className="p-1.5 rounded hover:bg-gray-200 text-sm"
                    title="列表"
                  >
                    •
                  </button>
                  <button
                    onClick={() =>
                      updateArticle("content", article.content + "\n1. ")
                    }
                    className="p-1.5 rounded hover:bg-gray-200 text-sm"
                    title="数字列表"
                  >
                    1.
                  </button>
                  <button
                    onClick={() =>
                      updateArticle("content", article.content + "\n> ")
                    }
                    className="p-1.5 rounded hover:bg-gray-200 text-sm"
                    title="引用"
                  >
                    "
                  </button>
                  <button
                    onClick={() =>
                      updateArticle("content", article.content + "\n```\n\n```")
                    }
                    className="p-1.5 rounded hover:bg-gray-200 text-sm"
                    title="代码块"
                  >
                    {"<>"}
                  </button>
                  <button
                    onClick={() => {
                      const url = prompt("输入图片URL:");
                      if (url)
                        updateArticle(
                          "content",
                          article.content + `\n![图片](${url})`,
                        );
                    }}
                    className="p-1.5 rounded hover:bg-gray-200 text-sm"
                    title="图片"
                  >
                    🖼️
                  </button>
                  <button
                    onClick={() => {
                      const url = prompt("输入链接URL:");
                      if (url) {
                        const text = prompt("输入链接文字:") || url;
                        updateArticle(
                          "content",
                          article.content + `[${text}](${url})`,
                        );
                      }
                    }}
                    className="p-1.5 rounded hover:bg-gray-200 text-sm"
                    title="链接"
                  >
                    🔗
                  </button>
                </div>

                {/* 编辑/预览区域 */}
                {editorMode === "edit" ? (
                  <textarea
                    ref={mdContentRef}
                    value={article.content}
                    onChange={(e) => updateArticle("content", e.target.value)}
                    placeholder="使用 Markdown 编写文章..."
                    rows={20}
                    className="w-full px-4 py-3 outline-none font-mono text-sm resize-none"
                    style={{ lineHeight: 1.6 }}
                  />
                ) : (
                  <div
                    ref={previewRef}
                    className="prose max-w-none p-6 min-h-[400px] bg-white"
                  >
                    {renderMarkdown(article.content)}
                  </div>
                )}
              </div>
            ) : (
              // 富文本模式
              <div
                ref={richContentRef}
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) =>
                  updateArticle("content", e.currentTarget.innerHTML)
                }
                className="outline-none border rounded-lg p-4 min-h-[400px] focus:border-blue-300 focus:ring-2 focus:ring-blue-100 article-content"
                style={{
                  fontSize: "16px",
                  lineHeight: "1.8",
                  color: "#333",
                }}
                dangerouslySetInnerHTML={{ __html: article.content }}
              />
            )}
          </div>

          {/* 元信息 */}
          <div className="text-xs text-gray-400 flex items-center justify-between mt-4 pt-4 border-t">
            <span>
              {article.publishDate
                ? `发布于: ${new Date(article.publishDate).toLocaleString()}`
                : "未发布"}
            </span>
            <span>
              字数: {article.content.length} | 预估阅读时间:{" "}
              {Math.ceil(article.content.length / 500)} 分钟
            </span>
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
    </div>
  );
}
