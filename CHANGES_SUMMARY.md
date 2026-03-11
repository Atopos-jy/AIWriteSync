# 功能修改总结

## 修改内容

### 1. 修复头条号"无广告权限"问题
**文件**: `packages/core/src/adapters/platforms/toutiao.ts`

- 第 156 行：将 `article_ad_type` 从 `'3'` 改为 `'0'`
- 添加注释说明：`0: 不投放广告, 3: 投放广告(需要广告权限)`
- 第 238-258 行：改进 JSON 解析错误处理，先获取文本再解析
- 第 84、151 行：添加调试日志记录 `draftOnly` 和 `save` 参数

### 2. 修复 Extractor 的消息解析错误
**文件**: `packages/extension/src/content/extractor.ts`

- 第 444-451 行：添加 try-catch 来忽略无法解析的消息（如头条的 `"[tea-sdk]ready"`）
- 添加消息类型检查，只处理有效的消息

### 3. 添加"直接发布"功能

#### 3.1 微信内容脚本 UI
**文件**: `packages/extension/src/content/weixin.ts`

**修改点**：
- 第 30 行：在 `SyncState` 接口添加 `publishDirectly: boolean` 字段
- 第 42 行：初始化 `publishDirectly: false`
- 第 435-462 行：添加复选框样式 CSS
- 第 479-486 行：添加复选框 HTML（在平台选择区域和同步按钮之间）
- 第 525 行：获取复选框元素引用
- 第 530-532 行：监听复选框变化事件
- 第 668 行：在发送同步消息时传递 `draftOnly: !state.publishDirectly`

#### 3.2 Popup UI
**文件**: `packages/extension/src/popup/stores/sync.ts`

- 第 139 行：在 `SyncState` 接口添加 `publishDirectly: boolean` 字段
- 第 147 行：添加 `setPublishDirectly` 方法
- 第 201 行：初始化 `publishDirectly: false`
- 第 387-391 行：添加 `setPublishDirectly` 方法实现
- 第 395 行：`startSync` 函数中获取 `publishDirectly` 状态
- 第 413 行：发送消息时传递 `draftOnly: !publishDirectly`
- 第 471 行：`retryFailed` 函数中也传递 `draftOnly`

**文件**: `packages/extension/src/popup/pages/HomeNew.tsx`

- 第 21 行：从 store 中获取 `publishDirectly` 和 `setPublishDirectly`
- 第 509-516 行：在同步按钮上方添加"直接发布"复选框

#### 3.3 适配器层

**头条适配器**
**文件**: `packages/core/src/adapters/platforms/toutiao.ts`

- 第 150-151 行：根据 `options?.draftOnly` 参数动态设置 `save` 值
  - `draftOnly === false` → `save = '0'` (直接发布)
  - `draftOnly !== false` → `save = '1'` (保存草稿)

**掘金适配器**
**文件**: `packages/core/src/adapters/platforms/juejin.ts`

- 第 283-362 行：添加直接发布逻辑
  - 先创建草稿
  - 如果 `draftOnly === false`，调用发布接口 `article/publish`
  - 发布成功返回文章链接，失败则返回草稿链接
  - 使用 try-catch 确保发布失败时不影响草稿创建

**文件**: `packages/extension/src/adapters/index.ts`

- 第 493-497 行：`syncToMultiplePlatforms` 函数添加 `draftOnly` 参数
- 第 579 行：将 `draftOnly` 传递给 `syncToPlatform` 调用

#### 3.4 同步服务层
**文件**: `packages/extension/src/background/sync-service.ts`

- 第 62 行：`SyncOptions` 接口添加 `draftOnly?: boolean` 字段
- 第 237 行：`performSync` 函数接收 `draftOnly` 参数（默认 `true`）
- 第 295 行：将 `draftOnly` 传递给 `syncToMultiplePlatforms`
- 第 336、338、340 行：CMS 同步时使用 `draftOnly` 参数
- 第 345 行：CMS 结果中使用 `draftOnly` 值

#### 3.5 Background 主文件
**文件**: `packages/extension/src/background/index.ts`

- 第 129 行：消息类型定义添加 `draftOnly?: boolean` 字段
- 第 204 行：接收 `draftOnly` 参数（默认 `true`）
- 第 323 行：将 `draftOnly` 传递给 `syncToMultiplePlatforms`
- 第 367、369、371 行：CMS 同步时使用 `draftOnly` 参数

## 使用方法

### 方式 1：微信文章页面悬浮按钮

1. 打开微信公众号文章页面
2. 点击右下角的"同步"悬浮按钮
3. 在弹出的面板中选择要同步的平台
4. **勾选"直接发布"复选框**（默认不勾选，保存为草稿）
5. 点击"同步到 X 个平台"按钮

### 方式 2：扩展 Popup

1. 点击浏览器工具栏的扩展图标
2. 在 Popup 中选择要同步的平台
3. **勾选"直接发布"复选框**（默认不勾选，保存为草稿）
4. 点击"🚀 同步到 X 个平台"按钮

## 平台支持情况

| 平台 | 直接发布支持 | 说明 |
|-----|------------|------|
| 头条号 | ✅ 支持 | 通过 `save` 参数控制 |
| 掘金 | ✅ 支持 | 先创建草稿，再调用发布接口 |
| 其他平台 | ⚠️ 待实现 | 目前仍保存为草稿 |

## 控制逻辑

```
用户勾选"直接发布"
    ↓
publishDirectly = true
    ↓
发送消息时 draftOnly = !publishDirectly (即 false)
    ↓
传递到 background
    ↓
传递到 syncToMultiplePlatforms
    ↓
传递到各平台适配器的 publish 方法
    ↓
头条: save = '0' (直接发布)
掘金: 调用 article/publish 接口
其他平台: 根据各自的 API 参数控制
```

## 构建说明

由于当前环境遇到 Node.js 兼容性问题，需要：

1. 升级 Node.js 到 20+ 版本，或
2. 修复 undici 包的兼容性问题

构建命令：
```bash
# 构建核心包（必须）
pnpm build:core

# 构建扩展包
pnpm build:extension

# 或一次性构建所有
pnpm build
```

## 重要提示

⚠️ **必须重新构建才能生效**

修改代码后，必须：
1. 重新构建项目：`pnpm build:core && pnpm build:extension`
2. 在 Chrome 中重新加载扩展
3. 刷新使用扩展的页面

检查是否使用最新版本：
- 查看 `packages/core/dist/` 和 `packages/extension/dist/` 的修改时间
- 应该晚于源文件的修改时间
