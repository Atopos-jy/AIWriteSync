import { Check, CheckCheck, Loader2, ExternalLink, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSyncStore } from '../stores/sync'
import { Button } from './ui/Button'

export function PlatformList() {
  const {
    status,
    platforms,
    selectedPlatforms,
    article,
    error,
    togglePlatform,
    selectAll,
    deselectAll,
    startSync,
  } = useSyncStore()

  const hasSelection = selectedPlatforms.length > 0
  const allSelected = platforms.length > 0 && selectedPlatforms.length === platforms.length

  // 加载中
  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-8 h-8 mb-3 animate-spin" />
        <p className="text-sm">检测平台登录状态...</p>
      </div>
    )
  }

  // 没有已登录的平台
  if (platforms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <p className="text-sm mb-2">未检测到可用的同步目标</p>
        <p className="text-xs text-center px-4">
          请先登录第三方平台，或在「账户」页面添加自建站点
        </p>
        <div className="flex flex-wrap justify-center gap-2 mt-4">
          <a
            href="https://www.zhihu.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            知乎 <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href="https://www.jianshu.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            简书 <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href="https://juejin.cn"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            掘金 <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted-foreground">
          {platforms.length} 个可用，已选 {selectedPlatforms.length} 个
        </span>
        <button
          onClick={allSelected ? deselectAll : selectAll}
          className="text-sm text-primary hover:underline"
        >
          {allSelected ? '取消全选' : '全选'}
        </button>
      </div>

      {/* 平台列表 */}
      <div className="flex-1 overflow-auto space-y-2 mb-4">
        {platforms.map(platform => {
          const isSelected = selectedPlatforms.includes(platform.id)

          return (
            <button
              key={platform.id}
              onClick={() => togglePlatform(platform.id)}
              className={cn(
                'w-full flex items-center gap-3 p-3 rounded-lg border transition-colors',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              )}
            >
              <img
                src={platform.icon}
                alt={platform.name}
                className="w-8 h-8 rounded flex-shrink-0"
                onError={e => {
                  (e.target as HTMLImageElement).src = '/assets/icon-48.png'
                }}
              />

              <div className="flex-1 text-left">
                <div className="text-sm font-medium">{platform.name}</div>
                {platform.username && (
                  <div className="text-xs text-muted-foreground">
                    {platform.username}
                  </div>
                )}
              </div>

              <div
                className={cn(
                  'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors',
                  isSelected
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground'
                )}
              >
                {isSelected && <Check className="w-3 h-3 text-white" />}
              </div>
            </button>
          )
        })}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 p-3 mb-3 rounded-lg bg-red-50 border border-red-200 text-red-600">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* 同步按钮 */}
      <Button
        onClick={() => startSync()}
        disabled={!article || !hasSelection}
        className="w-full"
        size="lg"
      >
        <CheckCheck className="w-4 h-4 mr-2" />
        同步到 {selectedPlatforms.length} 个平台
      </Button>
    </div>
  )
}
