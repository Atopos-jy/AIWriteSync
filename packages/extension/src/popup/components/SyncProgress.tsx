import { useState } from 'react'
import { CheckCircle, XCircle, Loader2, ExternalLink, RotateCcw, ImageIcon, RefreshCw, StopCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSyncStore } from '../stores/sync'
import { Button } from './ui/Button'

export function SyncProgress() {
  const {
    status,
    selectedPlatforms,
    results,
    platforms,
    imageProgress,
    reset,
    retryFailed,
  } = useSyncStore()

  const [cancelling, setCancelling] = useState(false)

  // 取消同步
  const handleCancel = async () => {
    setCancelling(true)
    try {
      await chrome.runtime.sendMessage({ type: 'CANCEL_SYNC' })
    } catch (e) {
      // ignore
    }
  }

  const successCount = results.filter(r => r.success).length
  const failedCount = results.filter(r => !r.success).length
  const pendingCount = selectedPlatforms.length - results.length

  const getPlatformName = (id: string) => {
    // 先从结果中查找已存储的名称
    const result = results.find(r => r.platform === id)
    if (result?.platformName) return result.platformName
    // 再从平台列表中查找
    return platforms.find(p => p.id === id)?.name || id
  }

  const hasFailedResults = failedCount > 0

  return (
    <div className="flex flex-col h-full">
      {/* 状态摘要 */}
      <div className="mb-4 p-4 rounded-lg bg-muted">
        <div className="flex items-center justify-center gap-6 text-sm">
          <div className="flex items-center gap-1.5">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span>{successCount} 成功</span>
          </div>
          <div className="flex items-center gap-1.5">
            <XCircle className="w-4 h-4 text-red-500" />
            <span>{failedCount} 失败</span>
          </div>
          {pendingCount > 0 && (
            <div className="flex items-center gap-1.5">
              <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
              <span>{pendingCount} 进行中</span>
            </div>
          )}
        </div>

        {/* 图片上传进度 */}
        {imageProgress && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ImageIcon className="w-3.5 h-3.5" />
              <span>
                {getPlatformName(imageProgress.platform)} 正在上传图片 ({imageProgress.current}/{imageProgress.total})
              </span>
            </div>
            <div className="mt-1.5 h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${(imageProgress.current / imageProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 结果列表 */}
      <div className="flex-1 overflow-auto space-y-2 mb-4">
        {selectedPlatforms.map(platformId => {
          const result = results.find(r => r.platform === platformId)
          const isPending = !result
          const isSuccess = result?.success
          const name = getPlatformName(platformId)
          const isCurrentlyUploading = imageProgress?.platform === platformId

          return (
            <div
              key={platformId}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg border',
                isPending && 'border-border',
                isSuccess && 'border-green-200 bg-green-50',
                result && !isSuccess && 'border-red-200 bg-red-50'
              )}
            >
              {/* 状态图标 */}
              <div className="flex-shrink-0">
                {isPending && (
                  <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                )}
                {isSuccess && (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                )}
                {result && !isSuccess && (
                  <XCircle className="w-5 h-5 text-red-500" />
                )}
              </div>

              {/* 平台名称和状态 */}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{name}</div>
                {isPending && isCurrentlyUploading && (
                  <div className="text-xs text-blue-600 mt-0.5">
                    上传图片中 ({imageProgress.current}/{imageProgress.total})
                  </div>
                )}
                {isPending && !isCurrentlyUploading && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    等待中...
                  </div>
                )}
                {isSuccess && result?.draftOnly && (
                  <div className="text-xs text-green-600 mt-0.5">
                    已保存草稿
                  </div>
                )}
                {isSuccess && !result?.draftOnly && result?.postUrl && (
                  <div className="text-xs text-green-600 mt-0.5">
                    已发布
                  </div>
                )}
                {result?.error && (
                  <div className="text-xs text-red-600 truncate mt-0.5">
                    {result.error}
                  </div>
                )}
              </div>

              {/* 链接 */}
              {result?.postUrl && (
                <a
                  href={result.postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded hover:bg-black/5 transition-colors"
                  title="查看文章"
                >
                  <ExternalLink className="w-4 h-4 text-muted-foreground" />
                </a>
              )}
            </div>
          )
        })}
      </div>

      {/* 底部操作 - 同步中 */}
      {status === 'syncing' && pendingCount > 0 && (
        <div className="space-y-2">
          <Button
            onClick={handleCancel}
            disabled={cancelling}
            variant="outline"
            className="w-full text-orange-600 border-orange-300 hover:bg-orange-50"
          >
            <StopCircle className="w-4 h-4 mr-2" />
            {cancelling ? '正在取消...' : '取消同步'}
          </Button>
        </div>
      )}

      {/* 底部操作 - 完成后 */}
      {status === 'completed' && (
        <div className="space-y-2">
          {/* 重试失败按钮 */}
          {hasFailedResults && (
            <Button onClick={retryFailed} className="w-full">
              <RefreshCw className="w-4 h-4 mr-2" />
              重试失败的平台 ({failedCount})
            </Button>
          )}

          {/* 返回按钮 */}
          <Button onClick={reset} variant="outline" className="w-full">
            <RotateCcw className="w-4 h-4 mr-2" />
            返回重新选择
          </Button>
        </div>
      )}
    </div>
  )
}
