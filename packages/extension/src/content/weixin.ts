/**
 * 微信公众号页面 Content Script
 * 优化的同步按钮体验
 */

import { htmlToMarkdownNative } from "@aiwritesync/core";
import {
  preprocessContentDOM,
  backupAndSimplifyCodeBlocks,
  restoreCodeBlocks,
} from "../lib/content-processor";
(() => {
  interface Platform {
    id: string;
    name: string;
    icon: string;
    isAuthenticated: boolean;
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

  interface SyncState {
    status: "idle" | "syncing" | "success" | "error";
    platforms: Platform[];
    results: Array<{
      platform: string;
      success: boolean;
      postUrl?: string;
      error?: string;
    }>;
    platformProgress: Map<string, PlatformProgress>;
    selectedPlatforms: string[];
    currentSyncId: string | null;
    publishDirectly: boolean; // 是否直接发布（而非保存草稿）
  }

  const state: SyncState = {
    status: "idle",
    platforms: [],
    results: [],
    platformProgress: new Map(),
    selectedPlatforms: [],
    currentSyncId: null,
    publishDirectly: false, // 默认保存为草稿
  };

  function injectSyncButton() {
    // 检查是否是文章页面
    const articleContent = document.querySelector("#js_content");
    if (!articleContent) return;

    // 检查是否已注入
    if (document.querySelector("#aiwritesync-fab")) return;

    // 创建悬浮按钮容器
    const container = document.createElement("div");
    container.id = "aiwritesync-fab";
    container.innerHTML = `
    <style>
      #aiwritesync-fab {
        position: fixed;
        right: 24px;
        bottom: 88px;
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      /* 主按钮 - 胶囊形状带文字 */
      .aiwritesync-main-btn {
        height: 40px;
        padding: 0 16px;
        border-radius: 20px;
        background: linear-gradient(135deg, #07c160 0%, #06ad56 100%);
        border: none;
        box-shadow: 0 4px 12px rgba(7, 193, 96, 0.35);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        color: white;
        font-size: 14px;
        font-weight: 500;
      }

      .aiwritesync-main-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 20px rgba(7, 193, 96, 0.45);
      }

      .aiwritesync-main-btn svg {
        width: 18px;
        height: 18px;
        fill: white;
        transition: transform 0.3s;
      }

      /* 同步中旋转动画 */
      .aiwritesync-main-btn.syncing svg {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      /* 成功状态 */
      .aiwritesync-main-btn.success {
        background: linear-gradient(135deg, #52c41a 0%, #389e0d 100%);
      }

      /* 失败状态 */
      .aiwritesync-main-btn.error {
        background: linear-gradient(135deg, #ff4d4f 0%, #cf1322 100%);
      }

      /* 平台展开面板 */
      .aiwritesync-panel {
        position: absolute;
        bottom: 60px;
        right: 0;
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
        padding: 12px;
        min-width: 200px;
        opacity: 0;
        visibility: hidden;
        transform: translateY(10px) scale(0.95);
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }

      #aiwritesync-fab:hover .aiwritesync-panel,
      #aiwritesync-fab.expanded .aiwritesync-panel {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
      }

      .aiwritesync-panel-header {
        font-size: 12px;
        color: #999;
        margin-bottom: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid #f0f0f0;
      }

      /* 平台列表 */
      .aiwritesync-platforms {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 12px;
      }

      .aiwritesync-platform {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s;
        border: 2px solid transparent;
        background: #f5f5f5;
        font-size: 12px;
      }

      .aiwritesync-platform:hover {
        background: #e8f5e9;
      }

      .aiwritesync-platform.selected {
        border-color: #07c160;
        background: #e8f5e9;
      }

      .aiwritesync-platform img {
        width: 16px;
        height: 16px;
        border-radius: 3px;
      }

      .aiwritesync-platform .status-icon {
        margin-left: auto;
      }

      .aiwritesync-platform .status-icon.success {
        color: #52c41a;
      }

      .aiwritesync-platform .status-icon.error {
        color: #ff4d4f;
      }

      /* 操作按钮 */
      .aiwritesync-actions {
        display: flex;
        gap: 8px;
      }

      .aiwritesync-sync-btn {
        flex: 1;
        padding: 8px 12px;
        border: none;
        border-radius: 6px;
        background: #07c160;
        color: white;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
      }

      .aiwritesync-sync-btn:hover {
        background: #06ad56;
      }

      .aiwritesync-sync-btn:disabled {
        background: #ccc;
        cursor: not-allowed;
      }

      .aiwritesync-more-btn {
        padding: 8px 12px;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        background: white;
        color: #666;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s;
      }

      .aiwritesync-more-btn:hover {
        border-color: #07c160;
        color: #07c160;
      }

      /* 结果提示 */
      .aiwritesync-toast {
        position: absolute;
        bottom: 60px;
        right: 0;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        padding: 12px 16px;
        font-size: 13px;
        white-space: nowrap;
        opacity: 0;
        visibility: hidden;
        transform: translateY(10px);
        transition: all 0.2s;
      }

      .aiwritesync-toast.show {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      .aiwritesync-toast.success {
        border-left: 3px solid #52c41a;
      }

      .aiwritesync-toast.error {
        border-left: 3px solid #ff4d4f;
      }

      .aiwritesync-toast.warning {
        border-left: 3px solid #faad14;
        background: #fffbe6;
      }

      /* 加载状态 */
      .aiwritesync-loading {
        text-align: center;
        padding: 20px;
        color: #999;
        font-size: 12px;
      }

      /* 同步结果列表 */
      .aiwritesync-results {
        margin-bottom: 12px;
        max-height: 200px;
        overflow-y: auto;
      }

      .aiwritesync-result-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 6px;
        margin-bottom: 6px;
        font-size: 12px;
      }

      .aiwritesync-result-item.success {
        background: #f6ffed;
        border: 1px solid #b7eb8f;
      }

      .aiwritesync-result-item.error {
        background: #fff2f0;
        border: 1px solid #ffccc7;
      }

      .aiwritesync-result-item img {
        width: 16px;
        height: 16px;
        border-radius: 3px;
      }

      .aiwritesync-result-item .name {
        flex: 1;
      }

      .aiwritesync-result-item .status {
        font-size: 11px;
      }

      .aiwritesync-result-item .status.success {
        color: #52c41a;
        background: none;
        border: none;
      }

      .aiwritesync-result-item .status.error {
        color: #ff4d4f;
        background: none;
        border: none;
      }

      .aiwritesync-result-item a {
        color: #1890ff;
        text-decoration: none;
        font-size: 11px;
      }

      .aiwritesync-result-item a:hover {
        text-decoration: underline;
      }

      /* 同步进度列表 */
      .aiwritesync-progress {
        margin-bottom: 12px;
        max-height: 200px;
        overflow-y: auto;
      }

      .aiwritesync-progress-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 4px;
        margin-bottom: 4px;
        font-size: 12px;
        background: #f9f9f9;
      }

      .aiwritesync-progress-item.active {
        background: #e6f7e6;
      }

      .aiwritesync-progress-item.success {
        background: #f6ffed;
      }

      .aiwritesync-progress-item.error {
        background: #fff2f0;
      }

      .aiwritesync-progress-item.pending {
        color: #999;
      }

      .aiwritesync-progress-icon {
        width: 14px;
        text-align: center;
        flex-shrink: 0;
        font-size: 11px;
      }

      .aiwritesync-progress-item.success .aiwritesync-progress-icon { color: #52c41a; }
      .aiwritesync-progress-item.error .aiwritesync-progress-icon { color: #ff4d4f; }
      .aiwritesync-progress-item.active .aiwritesync-progress-icon { color: #07c160; }

      .aiwritesync-progress-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .aiwritesync-progress-status {
        font-size: 11px;
        color: #666;
        flex-shrink: 0;
        max-width: 70px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .aiwritesync-progress-item.error .aiwritesync-progress-status { color: #ff4d4f; }

      /* 底部链接 */
      .aiwritesync-footer {
        display: flex;
        justify-content: space-between;
        padding-top: 8px;
        border-top: 1px solid #f0f0f0;
        margin-top: 8px;
      }

      .aiwritesync-footer a {
        color: #999;
        text-decoration: none;
        font-size: 11px;
      }

      .aiwritesync-footer a:hover {
        color: #07c160;
      }

      /* 发布选项 */
      .aiwritesync-publish-option {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 0;
        font-size: 12px;
        color: #666;
        border-bottom: 1px solid #f0f0f0;
        margin-bottom: 8px;
      }

      .aiwritesync-publish-option input[type="checkbox"] {
        width: 14px;
        height: 14px;
        cursor: pointer;
      }

      .aiwritesync-publish-option label {
        cursor: pointer;
        user-select: none;
      }

      .aiwritesync-publish-option .warning-text {
        color: #ff4d4f;
        font-size: 11px;
        margin-left: 4px;
      }
    </style>

    <div class="aiwritesync-panel">
      <div class="aiwritesync-panel-header" id="aiwritesync-panel-header">选择同步平台</div>

      <!-- 同步结果区域（同步后显示） -->
      <div class="aiwritesync-results" id="aiwritesync-results" style="display: none;"></div>

      <!-- 同步进度区域（同步中显示） -->
      <div class="aiwritesync-progress" id="aiwritesync-progress" style="display: none;"></div>

      <!-- 平台选择区域 -->
      <div class="aiwritesync-platforms" id="aiwritesync-platforms">
        <div class="aiwritesync-loading">加载中...</div>
      </div>

      <!-- 发布选项 -->
      <div class="aiwritesync-publish-option">
        <input type="checkbox" id="aiwritesync-publish-directly" />
        <label for="aiwritesync-publish-directly">
          直接发布
          <span class="warning-text">(默认保存为草稿)</span>
        </label>
      </div>

      <div class="aiwritesync-actions">
        <button class="aiwritesync-sync-btn" id="aiwritesync-sync-btn" disabled>
          同步到选中平台
        </button>
        <button class="aiwritesync-more-btn" id="aiwritesync-more-btn" title="更多选项">
          ⋯
        </button>
      </div>

      <div class="aiwritesync-footer">
        <a href="javascript:void(0)" id="aiwritesync-history-link">同步历史</a>
        <a href="javascript:void(0)" id="aiwritesync-add-cms-link">添加站点</a>
      </div>
    </div>

    <div class="aiwritesync-toast" id="aiwritesync-toast"></div>

    <button class="aiwritesync-main-btn" id="aiwritesync-main-btn" title="同步文章到多平台">
      <svg viewBox="0 0 24 24">
        <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
      </svg>
      <span>同步</span>
    </button>
  `;

    document.body.appendChild(container);

    // 绑定事件
    const mainBtn = document.getElementById(
      "aiwritesync-main-btn",
    ) as HTMLButtonElement;
    const syncBtn = document.getElementById(
      "aiwritesync-sync-btn",
    ) as HTMLButtonElement;
    const moreBtn = document.getElementById(
      "aiwritesync-more-btn",
    ) as HTMLButtonElement;
    const platformsContainer = document.getElementById("aiwritesync-platforms")!;
    const resultsContainer = document.getElementById("aiwritesync-results")!;
    const progressContainer = document.getElementById("aiwritesync-progress")!;
    const panelHeader = document.getElementById("aiwritesync-panel-header")!;
    const historyLink = document.getElementById("aiwritesync-history-link")!;
    const addCmsLink = document.getElementById("aiwritesync-add-cms-link")!;
    const publishDirectlyCheckbox = document.getElementById(
      "aiwritesync-publish-directly",
    ) as HTMLInputElement;

    // 加载平台列表
    loadPlatforms();

    // 监听发布选项变化
    publishDirectlyCheckbox.addEventListener("change", () => {
      state.publishDirectly = publishDirectlyCheckbox.checked;
    });

    // 主按钮点击 - 展开/收起
    mainBtn.addEventListener("click", () => {
      container.classList.toggle("expanded");
    });

    // 同步按钮
    syncBtn.addEventListener("click", () => startSync());

    // 更多选项 - 打开完整 popup
    moreBtn.addEventListener("click", async () => {
      const article = extractWeixinArticle();
      if (article) {
        await chrome.storage.local.set({ pendingArticle: article });
      }
      chrome.runtime.sendMessage({ type: "OPEN_SYNC_PAGE" });
    });

    // 历史记录链接
    historyLink.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: "OPEN_SYNC_PAGE", path: "/history" });
    });

    // 添加站点链接
    addCmsLink.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: "OPEN_SYNC_PAGE", path: "/add-cms" });
    });

    /**
     * 加载已登录平台
     */
    async function loadPlatforms() {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "CHECK_ALL_AUTH",
        });
        state.platforms = (response.platforms || []).filter(
          (p: Platform) => p.isAuthenticated,
        );

        // 加载上次选择的平台
        const storage = await chrome.storage.local.get("lastSelectedPlatforms");
        const lastSelected: string[] = storage.lastSelectedPlatforms || [];

        renderPlatforms(lastSelected);
      } catch (error) {
        platformsContainer.innerHTML =
          '<div class="aiwritesync-loading">加载失败</div>';
      }
    }

    /**
     * 渲染平台列表
     */
    function renderPlatforms(selectedIds: string[] = []) {
      if (state.platforms.length === 0) {
        platformsContainer.innerHTML = `
        <div class="aiwritesync-loading">
          暂无已登录平台<br>
          <a href="javascript:void(0)" id="aiwritesync-login-link" style="color: #07c160;">去登录 →</a>
        </div>
      `;
        document
          .getElementById("aiwritesync-login-link")
          ?.addEventListener("click", (e) => {
            e.preventDefault();
            chrome.runtime.sendMessage({ type: "OPEN_SYNC_PAGE" });
          });
        return;
      }

      platformsContainer.innerHTML = state.platforms
        .map((p) => {
          const isSelected = selectedIds.includes(p.id);
          const result = state.results.find((r) => r.platform === p.id);
          let statusIcon = "";
          if (result) {
            statusIcon = result.success
              ? '<span class="status-icon success">✓</span>'
              : '<span class="status-icon error">✗</span>';
          }

          return `
        <div class="aiwritesync-platform ${isSelected ? "selected" : ""}" data-id="${p.id}">
          <img src="${p.icon}" alt="${p.name}" onerror="this.style.display='none'">
          <span>${p.name}</span>
          ${statusIcon}
        </div>
      `;
        })
        .join("");

      // 绑定平台选择事件
      platformsContainer
        .querySelectorAll(".aiwritesync-platform")
        .forEach((el) => {
          el.addEventListener("click", () => {
            el.classList.toggle("selected");
            updateSyncButton();
          });
        });

      updateSyncButton();
    }

    /**
     * 更新同步按钮状态
     */
    function updateSyncButton() {
      const selected = platformsContainer.querySelectorAll(
        ".aiwritesync-platform.selected",
      );
      syncBtn.disabled = selected.length === 0;
      syncBtn.textContent =
        selected.length > 0 ? `同步到 ${selected.length} 个平台` : "选择平台";
    }

    /**
     * 开始同步
     */
    async function startSync() {
      const article = extractWeixinArticle();
      if (!article) {
        showToast("未能提取文章内容", "error");
        // 追踪文章提取失败
        chrome.runtime
          .sendMessage({
            type: "TRACK_ARTICLE_EXTRACT",
            payload: { source: "weixin", success: false },
          })
          .catch(() => {});
        return;
      }

      // 追踪文章提取成功
      chrome.runtime
        .sendMessage({
          type: "TRACK_ARTICLE_EXTRACT",
          payload: {
            source: "weixin",
            success: true,
            hasTitle: !!article.title,
            hasContent: !!article.content,
            hasCover: !!article.cover,
            contentLength: article.content?.length || 0,
          },
        })
        .catch(() => {});

      // 获取选中的平台
      const selectedPlatforms: string[] = [];
      platformsContainer
        .querySelectorAll(".aiwritesync-platform.selected")
        .forEach((el) => {
          selectedPlatforms.push(el.getAttribute("data-id")!);
        });

      if (selectedPlatforms.length === 0) {
        showToast("请选择要同步的平台", "error");
        return;
      }

      // 保存到 state
      state.selectedPlatforms = selectedPlatforms;

      // 保存平台选择偏好
      await chrome.storage.local.set({
        lastSelectedPlatforms: selectedPlatforms,
      });

      // 生成 syncId（在发送消息前设置，以便立即过滤消息）
      const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // 更新状态
      state.status = "syncing";
      state.results = [];
      state.platformProgress.clear();
      state.currentSyncId = syncId;
      mainBtn.classList.add("syncing");
      mainBtn.classList.remove("success", "error");
      syncBtn.disabled = true;
      syncBtn.textContent = "同步中...";

      // 切换到进度视图
      platformsContainer.style.display = "none";
      resultsContainer.style.display = "none";
      progressContainer.style.display = "block";
      panelHeader.textContent = "同步中";
      renderSyncProgress();

      try {
        const response = await chrome.runtime.sendMessage({
          type: "SYNC_ARTICLE",
          payload: {
            article,
            platforms: selectedPlatforms,
            source: "weixin",
            syncId,
            draftOnly: !state.publishDirectly, // 传递发布选项
          },
        });

        state.results = response.results || [];
        const successCount = state.results.filter((r) => r.success).length;
        const failedCount = state.results.filter((r) => !r.success).length;

        state.status = failedCount === 0 ? "success" : "error";
        mainBtn.classList.remove("syncing");
        mainBtn.classList.add(state.status);

        // 显示结果列表（带草稿链接）
        renderResults();

        // 显示频率限制警告（如果有）
        if (response.rateLimitWarning) {
          showToast(response.rateLimitWarning, "warning", 8000);
        }

        // 显示 toast
        if (failedCount === 0) {
          showToast(`✓ 成功同步到 ${successCount} 个平台`, "success");
        } else {
          showToast(`${successCount} 成功，${failedCount} 失败`, "error");
        }
      } catch (error) {
        state.status = "error";
        mainBtn.classList.remove("syncing");
        mainBtn.classList.add("error");
        showToast("同步失败：" + (error as Error).message, "error");
      }
    }

    /**
     * 显示提示
     */
    function showToast(
      message: string,
      type: "success" | "error" | "warning",
      duration = 3000,
    ) {
      const toast = document.getElementById("aiwritesync-toast")!;
      toast.textContent = message;
      toast.className = `aiwritesync-toast show ${type}`;

      setTimeout(() => {
        toast.classList.remove("show");
      }, duration);
    }

    /**
     * 获取阶段文本
     */
    function getStageText(progress: PlatformProgress): string {
      switch (progress.stage) {
        case "starting":
          return "准备中...";
        case "uploading_images":
          return progress.imageProgress
            ? `上传图片 ${progress.imageProgress.current}/${progress.imageProgress.total}`
            : "上传图片...";
        case "saving":
          return "保存文章...";
        case "completed":
          return "完成";
        case "failed":
          return progress.error || "失败";
        default:
          return "等待中";
      }
    }

    /**
     * 渲染同步进度
     */
    function renderSyncProgress() {
      let html = "";
      for (const platformId of state.selectedPlatforms) {
        const platform = state.platforms.find((p) => p.id === platformId);
        const progress = state.platformProgress.get(platformId);
        const result = state.results.find((r) => r.platform === platformId);

        if (result) {
          // 已完成
          html += `
          <div class="aiwritesync-progress-item ${result.success ? "success" : "error"}">
            <span class="aiwritesync-progress-icon">${result.success ? "✓" : "✗"}</span>
            <span class="aiwritesync-progress-name">${platform?.name || platformId}</span>
            <span class="aiwritesync-progress-status">${result.success ? "完成" : result.error || "失败"}</span>
          </div>
        `;
        } else if (progress) {
          // 进行中
          html += `
          <div class="aiwritesync-progress-item active">
            <span class="aiwritesync-progress-icon">⟳</span>
            <span class="aiwritesync-progress-name">${platform?.name || platformId}</span>
            <span class="aiwritesync-progress-status">${getStageText(progress)}</span>
          </div>
        `;
        } else {
          // 等待中
          html += `
          <div class="aiwritesync-progress-item pending">
            <span class="aiwritesync-progress-icon">○</span>
            <span class="aiwritesync-progress-name">${platform?.name || platformId}</span>
            <span class="aiwritesync-progress-status">等待中</span>
          </div>
        `;
        }
      }
      progressContainer.innerHTML = html;
    }

    /**
     * 渲染同步结果（带草稿链接）
     */
    function renderResults() {
      // 隐藏进度视图
      progressContainer.style.display = "none";

      if (state.results.length === 0) {
        resultsContainer.style.display = "none";
        platformsContainer.style.display = "block";
        panelHeader.textContent = "选择同步平台";
        return;
      }

      // 切换到结果视图
      panelHeader.textContent = "同步结果";
      platformsContainer.style.display = "none";
      resultsContainer.style.display = "block";

      resultsContainer.innerHTML = state.results
        .map((r) => {
          const platform = state.platforms.find((p) => p.id === r.platform);
          const statusClass = r.success ? "success" : "error";
          const statusText = r.success ? "✓ 已同步" : "✗ 失败";

          let linkHtml = "";
          if (r.success && r.postUrl) {
            linkHtml = `<a href="${r.postUrl}" target="_blank">编辑草稿 →</a>`;
          } else if (!r.success) {
            linkHtml = `<span class="status error">${r.error || "未知错误"}</span>`;
          }

          return `
        <div class="aiwritesync-result-item ${statusClass}">
          <img src="${platform?.icon || ""}" alt="${platform?.name || r.platform}" onerror="this.style.display='none'">
          <span class="name">${platform?.name || r.platform}</span>
          <span class="status ${statusClass}">${statusText}</span>
          ${linkHtml}
        </div>
      `;
        })
        .join("");

      // 添加"继续同步"按钮
      syncBtn.textContent = "继续同步其他平台";
      syncBtn.disabled = false;
      syncBtn.onclick = () => {
        // 切换回平台选择视图
        state.results = [];
        state.platformProgress.clear();
        resultsContainer.style.display = "none";
        platformsContainer.style.display = "block";
        panelHeader.textContent = "选择同步平台";
        mainBtn.classList.remove("success", "error");
        loadPlatforms();
      };
    }

    // 监听来自 background 的进度消息
    chrome.runtime.onMessage.addListener((message) => {
      // 如果消息带有 syncId，需要匹配当前的 syncId
      if (
        message.syncId &&
        state.currentSyncId &&
        message.syncId !== state.currentSyncId
      ) {
        return; // 忽略不匹配的消息
      }

      if (message.type === "SYNC_DETAIL_PROGRESS") {
        const progress = message.payload;
        if (progress?.platform) {
          state.platformProgress.set(progress.platform, progress);
          if (state.status === "syncing") {
            renderSyncProgress();
          }
        }
      }
      if (message.type === "SYNC_PROGRESS") {
        // 单个平台完成，添加到结果
        const result = message.payload?.result;
        if (result && state.status === "syncing") {
          // 检查是否已存在
          if (!state.results.find((r) => r.platform === result.platform)) {
            state.results.push(result);
            renderSyncProgress();
          }
        }
      }
    });
  }

  /**
   * 提取微信公众号文章
   */
  /**
   * 提取微信公众号文章
   */
  function extractWeixinArticle() {
    // 标题
    const title =
      document.querySelector("#activity-name")?.textContent?.trim() ||
      document.querySelector(".rich_media_title")?.textContent?.trim();

    // 作者
    let author = "";
    const authorSpan = document.querySelector("#js_author_name_text");
    if (authorSpan) {
      author = authorSpan.textContent?.trim() || "";
    }
    // 备选：从 .rich_media_meta_text 中提取可见文本
    if (!author) {
      const authorContainer = document.querySelector(
        ".rich_media_meta_list .rich_media_meta.rich_media_meta_text",
      );
      if (authorContainer) {
        // 获取所有非隐藏的直接子节点文本（包括文本节点）
        const visibleText = Array.from(authorContainer.childNodes)
          .filter((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as HTMLElement;
              const style = window.getComputedStyle(el);
              return style.display !== "none" && style.visibility !== "hidden";
            }
            return true;
          })
          .map((node) => node.textContent?.trim() || "")
          .join("")
          .trim();
        author = visibleText;
      }
    }
    // 最终回退：.profile_nickname
    if (!author) {
      author =
        document.querySelector(".profile_nickname")?.textContent?.trim() || "";
    }

    // 摘要
    const summary =
      document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content") ||
      document
        .querySelector(
          ".rich_media_meta_list .rich_media_meta.rich_media_meta_text",
        )
        ?.textContent?.trim();

    // 内容元素
    const contentEl =
      document.querySelector("#js_content") ||
      document.querySelector(".rich_media_content");

    if (!title || !contentEl) return null;

    // 克隆内容以处理懒加载图片
    const clonedContent = contentEl.cloneNode(true) as HTMLElement;
    const imgSelectors = ["img[data-src]", "img[data-original]"];
    imgSelectors.forEach((selector) => {
      clonedContent
        .querySelectorAll<HTMLImageElement>(selector)
        .forEach((img) => {
          const lazySrc = img.getAttribute(
            selector === "img[data-src]" ? "data-src" : "data-original",
          );
          if (lazySrc) img.src = lazySrc;
        });
    });

    // 预处理（图片、链接、代码块等）
    const codeBlockBackups = backupAndSimplifyCodeBlocks(contentEl);
    try {
      // 克隆用于预处理和转换（避免影响原始页面）
      const processedClone = contentEl.cloneNode(true) as HTMLElement;
      restoreCodeBlocks(codeBlockBackups); // 立即恢复原 DOM

      preprocessContentDOM(processedClone);
      const htmlContent = processedClone.innerHTML;
      const markdown = htmlToMarkdownNative(htmlContent);

      // 封面
      const cover =
        document
          .querySelector('meta[property="og:image"]')
          ?.getAttribute("content") ||
        document.querySelector<HTMLImageElement>("#js_cover img")?.src;

      // 文章类型（原创/转载）
      let articleType = "";

      // 方法1：查找原创标签元素（微信公众号原创标记）
      const originalTag = Array.from(
        document.querySelectorAll(".rich_media_meta"),
      ).find(
        (el) =>
          el.textContent?.toLowerCase().includes("original") ||
          el.textContent?.includes("原创"),
      );

      // 方法2：查找阅读原文链接
      const readMoreLink = Array.from(document.querySelectorAll("a")).find(
        (el) =>
          el.textContent?.includes("阅读原文") ||
          el.textContent?.toLowerCase().includes("read more"),
      );

      if (originalTag) {
        articleType = "original";
      } else if (readMoreLink) {
        articleType = "reprint";
      }

      // 发布时间
      let publishDate = "";
      const publishDateMeta = document
        .querySelector('meta[property="og:article:published_time"]')
        ?.getAttribute("content");
      if (publishDateMeta) {
        publishDate = publishDateMeta;
      } else {
        const timeEl =
          document.querySelector("#post-date") ||
          document.querySelector(
            ".rich_media_meta_list .rich_media_meta.rich_media_meta_text:last-child",
          );
        if (timeEl) {
          const timeText = timeEl.textContent?.trim() || "";
          const match = timeText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
          if (match) {
            publishDate = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
          } else {
            publishDate = timeText;
          }
        }
      }

      return {
        title,
        author,
        summary: summary || undefined,
        cover: cover || undefined,
        html: htmlContent, // 富文本内容
        markdown, // Markdown 内容
        content: htmlContent, // 默认内容
        articleType,
        publishDate,
        source: {
          url: window.location.href,
          platform: "weixin",
        },
      };
    } catch (e) {
      restoreCodeBlocks(codeBlockBackups);
      throw e;
    }
  }

  // 页面加载完成后注入
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectSyncButton);
  } else {
    injectSyncButton();
  }
})();
