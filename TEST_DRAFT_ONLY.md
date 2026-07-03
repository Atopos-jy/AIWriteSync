# 测试 draftOnly 参数传递

## 问题
没有勾选"直接发布"，但同步到头条后直接发布了。

## 原因分析

### 1. 构建版本问题
- dist 目录构建时间：18:08
- 源文件修改时间：18:11
- **结论**：你使用的是旧版本，需要重新构建

### 2. 代码逻辑验证

#### 头条适配器逻辑（正确）
```typescript
// packages/core/src/adapters/platforms/toutiao.ts 第 150 行
formData.append('save', options?.draftOnly === false ? '0' : '1')
```

- `draftOnly === false` → `save = '0'` (直接发布) ✅
- `draftOnly === true` 或 `undefined` → `save = '1'` (保存草稿) ✅

#### 数据流传递（已修复）
1. ✅ UI 层：`draftOnly: !state.publishDirectly`
2. ✅ Background：接收并传递 `draftOnly`
3. ✅ Adapter：使用 `draftOnly` 参数

## 解决方案

### 立即解决：重新构建扩展

```bash
# 方案 1：构建所有包
pnpm build

# 方案 2：只构建核心和扩展
pnpm build:core && pnpm build:extension
```

### 验证步骤

1. 重新构建后，检查 dist 目录的时间戳
2. 在 Chrome 中重新加载扩展
3. 打开浏览器控制台（F12）
4. 切换到扩展的 Service Worker 控制台
5. 同步文章时查看日志输出：
   ```
   [Toutiao] Starting publish... { draftOnly: true }
   [Toutiao] Setting save parameter: { draftOnly: true, saveValue: '1' }
   ```

### 预期行为

| 复选框状态 | publishDirectly | draftOnly | save | 结果 |
|-----------|----------------|-----------|------|------|
| 未勾选 | false | true | '1' | 保存为草稿 ✅ |
| 已勾选 | true | false | '0' | 直接发布 ✅ |

## 调试日志

已添加调试日志到头条适配器：
- 第 84 行：记录 `draftOnly` 参数
- 第 151 行：记录 `save` 参数的值

查看日志方法：
1. 打开 Chrome DevTools
2. 切换到 "Service Worker" 或 "Background" 标签
3. 查找 `[Toutiao]` 开头的日志

## 注意事项

- 每次修改代码后必须重新构建
- 构建后必须在 Chrome 中重新加载扩展
- 清除浏览器缓存可能有帮助
