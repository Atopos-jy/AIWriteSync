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
 *
 * 所有 AI 方法在出错时会设置 error 状态并重新抛出异常，
 * 调用方应使用 try-catch 来捕获并处理错误。
 */
export function useAIPolish() {
  const [loading, setLoading] = useState<AIAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 缓存 processor 实例，配置变更时失效
  const processorRef = useRef<AIProcessor | null>(null)
  const configRef = useRef<string>('')
  // 用 ref 追踪最新 error 状态，避免闭包问题
  const errorRef = useRef<string | null>(null)

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
  const clearError = useCallback(() => {
    setError(null)
    errorRef.current = null
  }, [])

  /**
   * 设置错误（同时更新 state 和 ref）
   */
  const setErrorState = useCallback((msg: string) => {
    setError(msg)
    errorRef.current = msg
  }, [])

  /**
   * AI 润色标题 - 返回 3 个备选标题
   * 失败时抛出异常
   */
  const polishTitle = useCallback(
    async (title: string, platform?: string, content?: string): Promise<string[]> => {
      setErrorState('')
      setLoading('title')
      try {
        const processor = await getProcessor()
        const result = await processor.optimizeTitle(title, platform || '', content)
        return result
      } catch (e) {
        const msg = (e as Error).message || 'AI 标题润色失败'
        setErrorState(msg)
        throw e
      } finally {
        setLoading(null)
      }
    },
    [getProcessor, setErrorState]
  )

  /**
   * AI 润色正文
   * 失败时抛出异常
   */
  const polishContent = useCallback(
    async (content: string): Promise<string> => {
      setErrorState('')
      setLoading('content')
      try {
        const processor = await getProcessor()
        return await processor.polishContent(content)
      } catch (e) {
        const msg = (e as Error).message || 'AI 正文润色失败'
        setErrorState(msg)
        throw e
      } finally {
        setLoading(null)
      }
    },
    [getProcessor, setErrorState]
  )

  /**
   * AI 生成摘要
   * 失败时抛出异常
   */
  const generateSummary = useCallback(
    async (content: string, maxLength = 200): Promise<string> => {
      setErrorState('')
      setLoading('summary')
      try {
        const processor = await getProcessor()
        return await processor.generateSummary(content, maxLength)
      } catch (e) {
        const msg = (e as Error).message || 'AI 摘要生成失败'
        setErrorState(msg)
        throw e
      } finally {
        setLoading(null)
      }
    },
    [getProcessor, setErrorState]
  )

  /**
   * AI 推荐标签
   * 失败时抛出异常
   */
  const suggestTags = useCallback(
    async (content: string, platform?: string): Promise<string[]> => {
      setErrorState('')
      setLoading('tags')
      try {
        const processor = await getProcessor()
        return await processor.suggestTags(content, platform)
      } catch (e) {
        const msg = (e as Error).message || 'AI 标签推荐失败'
        setErrorState(msg)
        throw e
      } finally {
        setLoading(null)
      }
    },
    [getProcessor, setErrorState]
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
