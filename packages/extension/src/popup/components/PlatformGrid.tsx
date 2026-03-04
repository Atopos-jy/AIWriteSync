import { useState } from 'react'
import { Check, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Platform {
  id: string
  name: string
  icon: string
  isAuthenticated: boolean
  username?: string
  error?: string
  homepage?: string
}

interface PlatformGridProps {
  platforms: Platform[]
  selected: Set<string>
  onToggle: (id: string) => void
  onSelectAll: () => void
  loading?: boolean
  syncing?: string[] // 正在同步的平台
  results?: Record<string, { success: boolean; url?: string }> // 同步结果
}

export function PlatformGrid({
  platforms,
  selected,
  onToggle,
  onSelectAll,
  loading,
  syncing = [],
  results = {},
}: PlatformGridProps) {
  const authenticatedCount = platforms.filter(p => p.isAuthenticated).length
  const selectedCount = selected.size

  return (
    <div className="space-y-3">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          选择平台
          <span className="ml-2 text-muted-foreground">
            {selectedCount}/{authenticatedCount}
          </span>
        </span>
        <button
          onClick={onSelectAll}
          className="text-xs text-primary hover:underline"
          disabled={loading}
        >
          {selectedCount === authenticatedCount ? '取消全选' : '全选已登录'}
        </button>
      </div>

      {/* 平台网格 */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">加载平台...</span>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {platforms.map(platform => {
            const isSelected = selected.has(platform.id)
            const isSyncing = syncing.includes(platform.id)
            const result = results[platform.id]
            const canSelect = platform.isAuthenticated && !isSyncing

            // 点击处理：已登录则切换选中，未登录则跳转到登录页
            const handleClick = () => {
              if (canSelect) {
                onToggle(platform.id)
              } else if (!platform.isAuthenticated && platform.homepage) {
                chrome.tabs.create({ url: platform.homepage })
              }
            }

            return (
              <button
                key={platform.id}
                onClick={handleClick}
                disabled={isSyncing}
                className={cn(
                  'relative flex flex-col items-center p-3 rounded-lg border-2 transition-all',
                  'hover:shadow-sm',
                  isSelected && platform.isAuthenticated
                    ? 'border-primary bg-primary/5'
                    : 'border-transparent bg-muted/50',
                  !platform.isAuthenticated && 'opacity-60 hover:opacity-80 cursor-pointer',
                  isSyncing && 'animate-pulse'
                )}
              >
                {/* 选中标记 */}
                {isSelected && platform.isAuthenticated && (
                  <div className="absolute top-1 right-1">
                    <Check className="w-4 h-4 text-primary" />
                  </div>
                )}

                {/* 同步结果标记 */}
                {result && (
                  <div className={cn(
                    'absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center',
                    result.success ? 'bg-green-500' : 'bg-red-500'
                  )}>
                    {result.success ? (
                      <Check className="w-3 h-3 text-white" />
                    ) : (
                      <AlertCircle className="w-3 h-3 text-white" />
                    )}
                  </div>
                )}

                {/* 平台图标 */}
                <img
                  src={platform.icon}
                  alt={platform.name}
                  className="w-8 h-8 rounded mb-1"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/assets/icon-48.png'
                  }}
                />

                {/* 平台名称 */}
                <span className="text-xs font-medium truncate w-full text-center">
                  {platform.name}
                </span>

                {/* 状态 */}
                <span className={cn(
                  'text-[10px] truncate w-full text-center',
                  platform.isAuthenticated ? 'text-green-600' : 'text-muted-foreground'
                )}>
                  {isSyncing ? (
                    '同步中...'
                  ) : platform.isAuthenticated ? (
                    platform.username || '已登录'
                  ) : (
                    '未登录'
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
