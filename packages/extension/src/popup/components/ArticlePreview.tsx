import { FileText, AlertCircle } from 'lucide-react'
import { useSyncStore } from '../stores/sync'

export function ArticlePreview() {
  const { article } = useSyncStore()

  if (!article) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <AlertCircle className="w-12 h-12 mb-3" />
        <p className="text-sm">未检测到文章</p>
        <p className="text-xs mt-1">请在微信公众号文章页面使用</p>
      </div>
    )
  }

  return (
    <div className="mb-4 p-3 rounded-lg border bg-card">
      <div className="flex items-start gap-3">
        {article.cover ? (
          <img
            src={article.cover}
            alt="封面"
            className="w-16 h-16 rounded object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded bg-muted flex items-center justify-center flex-shrink-0">
            <FileText className="w-8 h-8 text-muted-foreground" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm line-clamp-2">{article.title}</h3>
          {article.summary && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {article.summary}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
