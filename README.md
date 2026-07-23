# 文稿 AI 同步助手 (AIWriteSync)

![](https://img.shields.io/github/v/release/Atopos-jy/AIWriteSync.svg)
![](https://img.shields.io/github/last-commit/Atopos-jy/AIWriteSync)
![](https://img.shields.io/github/issues/Atopos-jy/AIWriteSync)
[![](https://img.shields.io/badge/Microsoft%20Edge-已上架-blue?logo=microsoftedge)](https://microsoftedge.microsoft.com/addons/detail/%E6%96%87%E7%A8%BFai%E5%90%8C%E6%AD%A5%E5%8A%A9%E6%89%8B/lhgcmkdmegfkcdcnddamplcciliembod)

**开源免费**的跨平台文章同步工具 | 浏览器扩展 | 自媒体内容分发神器

一键同步微信公众号文章到知乎、头条、掘金、小红书、CSDN 等 25+ 平台，支持 WordPress 等自建博客，告别重复复制粘贴。

> 🔥 支持 **Anthropic MCP 协议**，可在 Claude Desktop / Claude Code 中通过 AI 一键发布文章
>
> 📦 已在 [**微软 Edge 扩展商店**](https://microsoftedge.microsoft.com/addons/detail/%E6%96%87%E7%A8%BFai%E5%90%8C%E6%AD%A5%E5%8A%A9%E6%89%8B/lhgcmkdmegfkcdcnddamplcciliembod) 上架，直接安装即可使用

---

## 🙏 致谢

本项目是基于 [WeChatSync](https://github.com/Yrobot/Wechatsync) 开源项目的二次开发版本，感谢原作者 **Yrobot** 及所有 [WeChatSync 贡献者](https://github.com/Yrobot/Wechatsync/graphs/contributors) 的优秀工作与开源精神。

在此基础上，我们进行了以下增强：
- 🎨 重塑品牌形象与 UI 界面
- 🌐 支持 Microsoft Edge 浏览器并上架扩展商店
- 🤖 集成 Anthropic MCP 协议，支持 AI 驱动的内容发布
- 🖥️ 新增 CLI 命令行工具，满足自动化场景
- 🔧 精简架构，提升稳定性与用户体验

---

## 工作原理

**文章同步助手不是爬虫，不模拟登录，不经过任何第三方服务器。**

它是一个 Chrome 浏览器扩展，工作方式与浏览器本身一致：

1. **使用你自己的登录态**：你在浏览器里正常登录各平台账号，扩展直接使用浏览器中已有的 Cookie，无需额外授权，无需输入密码
2. **调用平台官方接口**：发布文章时，扩展调用的是各平台 Web 编辑器使用的同一套官方 API，与你手动在网页上发布完全等价
3. **数据不离开你的设备**：所有请求直接从你的浏览器发往各平台，没有中间服务器，没有数据上传，源代码完全开源可审计
4. **草稿优先**：默认将文章同步为草稿，发布前由你人工确认，不会自动发布

```
你的浏览器（已登录各平台）
    ↓  扩展读取 Cookie
    ↓  调用平台官方 Web API
各平台（知乎 / 掘金 / 头条 / ...）
```

## 功能特性

- **一键批量发布**: 微信公众号文章同步到知乎、掘金、头条、CSDN、简书、微博、小红书等 25+ 自媒体平台
- **自建站支持**: WordPress、Typecho、博客园 (MetaWeblog API)
- **智能提取**: 自动从网页提取文章标题、内容、封面图（基于 Safari 阅读模式）
- **图片自动上传**: 自动转存文章图片到目标平台，无需手动处理
- **草稿模式**: 同步后保存为草稿，方便二次编辑后发布
- **MCP AI 集成**: 支持 Anthropic MCP 协议，配合 Claude Desktop / Claude Code 使用

## 安装方式

### Microsoft Edge 扩展商店（推荐）

直接在 [**Edge 扩展商店**](https://microsoftedge.microsoft.com/addons/detail/%E6%96%87%E7%A8%BFai%E5%90%8C%E6%AD%A5%E5%8A%A9%E6%89%8B/lhgcmkdmegfkcdcnddamplcciliembod) 搜索「**文稿 AI 同步助手**」一键安装即可。

### Chrome 浏览器手动安装

构建项目后，加载 `packages/extension/dist` 目录到 Chrome 扩展。

## 支持的平台

| 平台 | ID | 类型 | 状态 |
|-----|-----|-----|-----|
| 微信公众号 | weixin | 主流自媒体 | ✅ |
| 知乎 | zhihu | 主流自媒体 | ✅ |
| 微博 | weibo | 主流自媒体 | ✅ |
| 掘金 | juejin | 技术社区 | ✅ |
| CSDN | csdn | 技术社区 | ✅ |
| 简书 | jianshu | 通用 | ✅ |
| 头条号 | toutiao | 通用 | ✅ |
| B站专栏 | bilibili | 通用 | ✅ |
| 百家号 | baijiahao | 通用 | ✅ |
| 语雀 | yuque | 技术社区 | ✅ |
| 豆瓣 | douban | 通用 | ✅ |
| 搜狐号 | sohu | 通用 | ✅ |
| 人人都是产品经理 | woshipm | 产品 | ✅ |
| 大鱼号 | dayu | 通用 | ✅ |
| 一点号 | yidian | 通用 | ✅ |
| 51CTO | 51cto | 技术社区 | ✅ |
| 慕课网 | imooc | 技术社区 | ✅ |
| 开源中国 | oschina | 技术社区 | ✅ |
| SegmentFault | segmentfault | 技术社区 | ✅ |
| 小红书 | xiaohongshu | 主流自媒体 | ✅ |
| X (Twitter) | x | 海外 | ✅ |
| WordPress | wordpress | 自建站 | ✅ |
| Typecho | typecho | 自建站 | ✅ |

## CLI 命令行工具

最简单的使用方式，无需配置 MCP，安装即用：

```bash
npm install -g @aiwritesync/cli
```

需要先安装 Chrome 扩展并在扩展设置中启用「MCP 连接」获取 Token，然后：

```bash
export AIWRITESYNC_TOKEN="你的token"

# 同步文章到多个平台
aiwritesync sync article.md -p zhihu,juejin,csdn

# 查看平台登录状态
aiwritesync platforms --auth

# 从浏览器当前页面提取文章
aiwritesync extract -o article.md
```

## Claude Code / Claude Desktop 集成 (Anthropic MCP)

通过 Anthropic MCP 协议，可以在 Claude Code 或 Claude Desktop 中使用 AI 同步公众号文章到多个平台。

### 配置步骤

1. 构建项目: `pnpm build`
2. 在 Chrome 扩展设置中启用「MCP 连接」，并设置 Token
3. 在 `~/.claude/claude_desktop_config.json` 中添加配置：

```json
{
  "mcpServers": {
    "sync-assistant": {
      "command": "node",
      "args": ["/path/to/AIWriteSync/packages/mcp-server/dist/index.js"],
      "env": {
        "MCP_TOKEN": "your-secret-token-here"
      }
    }
  }
}
```

**重要**: `MCP_TOKEN` 必须与 Chrome 扩展中设置的 Token 一致。

### 使用示例

```
"帮我把这篇文章同步到知乎和掘金"
"检查下哪些平台已登录"
```

### 可用工具

| 工具 | 说明 |
|-----|------|
| `list_platforms` | 列出所有平台及登录状态 |
| `check_auth` | 检查指定平台登录状态 |
| `sync_article` | 同步文章到指定平台（草稿） |
| `extract_article` | 从当前浏览器页面提取文章 |
| `upload_image_file` | 上传本地图片到平台 |

详细文档见 [packages/mcp-server/README.md](packages/mcp-server/README.md)

## 开发

### 项目结构

```
AIWriteSync/
├── packages/
│   ├── extension/     # Chrome 扩展 (MV3)
│   ├── mcp-server/    # MCP Server (stdio/SSE)
│   ├── cli/           # 命令行工具
│   └── core/          # 核心逻辑 (共享)
```

### 本地开发

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build
```

然后在 Chrome 中加载 `packages/extension/dist` 目录。

## License

GPL-3.0
