/**
 * AI 润色操作 Hook
 * 提供统一的 AI 调用状态管理和错误处理
 */
import { useState, useCallback, useRef } from 'react'
import {
  createAIProcessor,
  isAIConfigured,
  type AIConfig,
  type AIProcessor,
} from '@aiwritesync/core'

const STORAGE_KEY = 'aiConfig'

/**
 * AI 操作类型
 */
type AIAction = 'title' | 'content' | 'summary' | 'tags'

/**
 * 加载 AI 配置
 */
async function loadAIConfig(): Promise<AIConfig | undefined> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY)
    return result[STORAGE_KEY] as AIConfig | undefined
  } catch {
    return undefined
  }
}

/**
 * AI 润色 Hook
 */
export function useAIPolish() {
  const [loading, setLoading] = useState<AIAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 缓存 processor 实例，配置变更时失效
  const processorRef = useRef<AIProcessor | null>(null)
  const configRef = useRef<string>('')

  /**
   * 获取或创建 AI Processor 实例
   */
  const getProcessor = useCallback(async (): Promise<AIProcessor> => {
    const config = await loadAIConfig()
    const configFingerprint = JSON.stringify(config || {})

    // 如果配置未变且有缓存实例，复用
    if (configFingerprint === configRef.current && processorRef.current) {
      return processorRef.current
    }

    configRef.current = configFingerprint
    processorRef.current = createAIProcessor(config)
    return processorRef.current
  }, [])

  /**
   * 检查是否已配置 AI
   */
  const checkConfigured = useCallback(async (): Promise<boolean> => {
    const config = await loadAIConfig()
    return isAIConfigured(config)
  }, [])

  /**
   * 统一的错误清除
   */
  const clearError = useCallback(() => setError(null), [])

  /**
   * AI 润色标题 - 返回 3 个备选标题
   */
  const polishTitle = useCallback(
    async (title: string, platform?: string, content?: string): Promise<string[]> => {
      setError(null)
      setLoading('title')
      try {
        const processor = await getProcessor()
        return await processor.optimizeTitle(title, platform || '', content)
      } catch (e) {
        const msg = (e as Error).message || 'AI 标题润色失败'
        setError(msg)
        return [title]
      } finally {
        setLoading(null)
      }
    },
    [getProcessor]
  )

  /**
   * AI 润色正文
   */
  const polishContent = useCallback(
    async (content: string): Promise<string> => {
      setError(null)
      setLoading('content')
      try {
        const processor = await getProcessor()
        return await processor.polishContent(content)
      } catch (e) {
        const msg = (e as Error).message || 'AI 正文润色失败'
        setError(msg)
        return content
      } finally {
        setLoading(null)
      }
    },
    [getProcessor]
  )

  /**
   * AI 生成摘要
   */
  const generateSummary = useCallback(
    async (content: string, maxLength = 200): Promise<string> => {
      setError(null)
      setLoading('summary')
      try {
        const processor = await getProcessor()
        return await processor.generateSummary(content, maxLength)
      } catch (e) {
        const msg = (e as Error).message || 'AI 摘要生成失败'
        setError(msg)
        return ''
      } finally {
        setLoading(null)
      }
    },
    [getProcessor]
  )

  /**
   * AI 推荐标签
   */
  const suggestTags = useCallback(
    async (content: string, platform?: string): Promise<string[]> => {
      setError(null)
      setLoading('tags')
      try {
        const processor = await getProcessor()
        return await processor.suggestTags(content, platform)
      } catch (e) {
        const msg = (e as Error).message || 'AI 标签推荐失败'
        setError(msg)
        return []
      } finally {
        setLoading(null)
      }
    },
    [getProcessor]
  )

  return {
    loading,
    error,
    clearError,
    checkConfigured,
    polishTitle,
    polishContent,
    generateSummary,
    suggestTags,
  }
}
