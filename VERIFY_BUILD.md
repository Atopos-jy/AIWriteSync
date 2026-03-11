# 验证构建版本

## 问题
没有勾选"直接发布"，但同步到头条时却直接发布了。

## 根本原因
**你正在使用旧版本的扩展！**

旧版本的代码中，头条的 `save` 参数是硬编码为 `'0'`（直接发布），而不是根据 `draftOnly` 参数动态设置。

## 验证步骤

### 1. 检查文件修改时间

```bash
# 查看源文件修改时间
ls -la packages/core/src/adapters/platforms/toutiao.ts

# 查看构建文件修改时间
ls -la packages/core/dist/adapters/index.js
ls -la packages/extension/dist/
```

**要求**：构建文件的时间必须晚于源文件的时间！

### 2. 检查构建文件内容

```bash
# 查看构建后的代码是否包含新逻辑
grep -A 2 "saveValue" packages/core/dist/adapters/index.js
```

应该能看到类似这样的代码：
```javascript
const saveValue = options?.draftOnly === false ? '0' : '1'
```

如果看不到，说明没有重新构建！

### 3. 检查扩展是否重新加载

在 Chrome 中：
1. 打开 `chrome://extensions/`
2. 找到"文章同步助手"扩展
3. 点击"重新加载"按钮（刷新图标）
4. 确认扩展的版本号或更新时间

### 4. 查看控制台日志

同步时查看日志：

1. 打开 Chrome DevTools (F12)
2. 切换到 "Console" 标签
3. 在过滤器中输入 `Toutiao`
4. 同步文章时应该看到：
   ```
   [Toutiao] Starting publish... { draftOnly: true }
   [Toutiao] Setting save parameter: { draftOnly: true, saveValue: '1' }
   ```

如果看到 `saveValue: '0'` 但 `draftOnly: true`，说明代码有问题。
如果看不到这些日志，说明使用的是旧版本。

## 完整的重新构建流程

### 步骤 1：清理旧的构建文件

```bash
# 清理核心包
rm -rf packages/core/dist

# 清理扩展包
rm -rf packages/extension/dist
```

### 步骤 2：重新构建

```bash
# 构建核心包（必须先构建）
cd packages/core
npm run build
cd ../..

# 构建扩展包
cd packages/extension
npm run build
cd ../..
```

或者使用 pnpm：

```bash
pnpm build:core
pnpm build:extension
```

### 步骤 3：验证构建结果

```bash
# 检查核心包是否构建成功
ls -la packages/core/dist/adapters/index.js

# 检查扩展包是否构建成功
ls -la packages/extension/dist/manifest.json

# 检查时间戳
date
ls -la packages/core/dist/adapters/index.js
```

### 步骤 4：在 Chrome 中重新加载扩展

1. 打开 `chrome://extensions/`
2. 找到"文章同步助手"
3. 点击"重新加载"按钮
4. 或者：先"移除"扩展，再"加载已解压的扩展程序"，选择 `packages/extension/dist` 目录

### 步骤 5：清除浏览器缓存（可选但推荐）

1. 打开 Chrome DevTools (F12)
2. 右键点击刷新按钮
3. 选择"清空缓存并硬性重新加载"

## 测试步骤

### 测试 1：验证草稿模式（默认）

1. 打开微信公众号文章页面
2. 点击"同步"按钮
3. 选择"头条号"
4. **不要勾选**"直接发布"
5. 点击"同步到 1 个平台"
6. 查看控制台日志，应该看到：
   ```
   [Toutiao] Setting save parameter: { draftOnly: true, saveValue: '1' }
   ```
7. 打开头条号后台，文章应该在**草稿箱**中

### 测试 2：验证直接发布模式

1. 打开微信公众号文章页面
2. 点击"同步"按钮
3. 选择"头条号"
4. **勾选**"直接发布"
5. 点击"同步到 1 个平台"
6. 查看控制台日志，应该看到：
   ```
   [Toutiao] Setting save parameter: { draftOnly: false, saveValue: '0' }
   ```
7. 打开头条号后台，文章应该**已发布**

## 常见问题

### Q1: 构建时报错 "File is not defined"

**原因**：Node.js 版本太低（18.x）
**解决**：升级到 Node.js 20+

```bash
# 检查 Node 版本
node --version

# 如果是 18.x，需要升级到 20+
```

### Q2: 构建成功但扩展没有更新

**原因**：Chrome 缓存了旧版本
**解决**：
1. 完全移除扩展
2. 重启 Chrome
3. 重新加载扩展

### Q3: 看不到控制台日志

**原因**：需要查看 Service Worker 的控制台
**解决**：
1. 打开 `chrome://extensions/`
2. 找到扩展，点击"Service Worker"链接
3. 在弹出的 DevTools 中查看日志

### Q4: 构建后文件时间还是旧的

**原因**：构建缓存问题
**解决**：
```bash
# 清理所有缓存
pnpm clean
rm -rf node_modules
pnpm install
pnpm build
```

## 预期结果对照表

| 场景 | draftOnly | saveValue | 头条结果 |
|-----|-----------|-----------|---------|
| 未勾选"直接发布" | true | '1' | 草稿箱 ✅ |
| 勾选"直接发布" | false | '0' | 已发布 ✅ |
| 旧版本（bug） | undefined | '0' | 已发布 ❌ |

## 如果还是不行

如果按照以上步骤操作后还是有问题，请提供：

1. 构建日志的最后 20 行
2. Chrome 控制台的完整日志（包含 `[Toutiao]` 的部分）
3. 文件时间戳：
   ```bash
   ls -la packages/core/src/adapters/platforms/toutiao.ts
   ls -la packages/core/dist/adapters/index.js
   ls -la packages/extension/dist/manifest.json
   ```
