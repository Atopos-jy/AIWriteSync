/**
 * AI 处理器接口及实现
 */
import {
  TITLE_POLISH_SYSTEM,
  CONTENT_POLISH_SYSTEM,
  SUMMARY_SYSTEM,
  TAGS_SYSTEM,
  buildTitlePolishUser,
  buildContentPolishUser,
  buildSummaryUser,
  buildTagsUser,
} from './prompts'

export interface AIProcessor {
  /**
   * 优化文章标题
   * @param title 原标题
   * @param platform 目标平台
   * @param content 文章正文（可选，用于更好理解上下文）
   * @returns 优化后的标题选项
   */
  optimizeTitle(
    title: string,
    platform: string,
    content?: string
  ): Promise<string[]>

  /**
   * 润色文章正文
   * @param content 文章内容
   * @returns 润色后的内容
   */
  polishContent(content: string): Promise<string>

  /**
   * 生成文章摘要
   * @param content 文章内容
   * @param maxLength 最大长度
   */
  generateSummary(content: string, maxLength?: number): Promise<string>

  /**
   * 推荐标签
   * @param content 文章内容
   * @param platform 目标平台
   */
  suggestTags(content: string, platform?: string): Promise<string[]>

  /**
   * 跨平台内容适配
   * @param content 原内容
   * @param sourcePlatform 来源平台
   * @param targetPlatform 目标平台
   */
  adaptContent(
    content: string,
    sourcePlatform: string,
    targetPlatform: string
  ): Promise<string>
}

/**
 * 空实现 AI 处理器
 * 直接返回原值，不做任何处理
 */
export class NoopAIProcessor implements AIProcessor {
  async optimizeTitle(title: string): Promise<string[]> {
    return [title]
  }

  async polishContent(content: string): Promise<string> {
    return content
  }

  async generateSummary(content: string, maxLength = 200): Promise<string> {
    const text = content.replace(/<[^>]+>/g, '').trim()
    if (text.length <= maxLength) return text
    return text.slice(0, maxLength - 3) + '...'
  }

  async suggestTags(): Promise<string[]> {
    return []
  }

  async adaptContent(content: string): Promise<string> {
    return content
  }
}

/**
 * OpenAI 兼容 API 消息格式
 */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * OpenAI 兼容 AI 处理器
 * 通过 OpenAI-compatible API 调用 LLM 进行内容处理
 */
export class OpenAIProcessor implements AIProcessor {
  private baseUrl: string
  private apiKey: string
  private model: string

  constructor(config: AIConfig) {
    this.baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(
      /\/$/,
      ''
    )
    this.apiKey = config.apiKey || ''
    this.model = config.model || 'gpt-4o-mini'
  }

  /**
   * 核心 API 调用方法
   */
  private async chat(
    messages: OpenAIMessage[],
    timeoutMs = 60000
  ): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.7,
          max_tokens: 4096,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        let errorMsg = `AI API 错误 (${response.status})`
        if (response.status === 401) errorMsg = 'AI API Key 无效，请检查设置'
        else if (response.status === 403)
          errorMsg = 'AI API 访问被拒绝，请检查权限'
        else if (response.status === 429)
          errorMsg = 'AI API 请求过于频繁，请稍后再试'
        else if (response.status === 500) errorMsg = 'AI API 服务器错误'
        else if (errorText) {
          try {
            const err = JSON.parse(errorText)
            errorMsg = err.error?.message || errorMsg
          } catch {}
        }
        throw new Error(errorMsg)
      }

      const data = await response.json()
      const text = data.choices?.[0]?.message?.content?.trim() || ''

      if (!text) {
        throw new Error('AI 返回了空内容')
      }

      return text
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error('AI 请求超时，请检查网络或 API 配置')
      }
      if ((error as TypeError).message?.includes('fetch')) {
        throw new Error(
          `无法连接到 AI 服务 (${this.baseUrl})，请检查 API 地址`
        )
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 安全解析 JSON 数组
   */
  private parseJSONArray(text: string): string[] {
    // 尝试直接解析
    try {
      const arr = JSON.parse(text)
      if (Array.isArray(arr)) return arr.filter((s) => typeof s === 'string')
    } catch {}

    // 尝试提取 JSON 数组
    const match = text.match(/\[[\s\S]*\]/)
    if (match) {
      try {
        const arr = JSON.parse(match[0])
        if (Array.isArray(arr)) return arr.filter((s) => typeof s === 'string')
      } catch {}
    }

    // 降级：按行分割
    return text
      .split(/\n/)
      .map((s) => s.replace(/^[\d.]+\s*/, '').replace(/^["']|["']$/g, '').trim())
      .filter((s) => s.length > 0)
  }

  async optimizeTitle(
    title: string,
    _platform: string,
    content?: string
  ): Promise<string[]> {
    const messages: OpenAIMessage[] = [
      { role: 'system', content: TITLE_POLISH_SYSTEM },
      { role: 'user', content: buildTitlePolishUser(title, content) },
    ]

    const response = await this.chat(messages)
    const titles = this.parseJSONArray(response)

    // 确保至少返回一个标题
    if (titles.length === 0) return [title]
    return titles.slice(0, 3)
  }

  async polishContent(content: string): Promise<string> {
    const messages: OpenAIMessage[] = [
      { role: 'system', content: CONTENT_POLISH_SYSTEM },
      { role: 'user', content: buildContentPolishUser(content) },
    ]

    const response = await this.chat(messages, 120000)
    return response
  }

  async generateSummary(content: string, maxLength = 200): Promise<string> {
    const system = `${SUMMARY_SYSTEM}\n注意：摘要请控制在 ${maxLength} 字以内。`
    const messages: OpenAIMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: buildSummaryUser(content, maxLength) },
    ]

    const response = await this.chat(messages)
    return response.slice(0, maxLength)
  }

  async suggestTags(content: string, _platform?: string): Promise<string[]> {
    const messages: OpenAIMessage[] = [
      { role: 'system', content: TAGS_SYSTEM },
      { role: 'user', content: buildTagsUser(content) },
    ]

    const response = await this.chat(messages)
    return this.parseJSONArray(response).slice(0, 5)
  }

  async adaptContent(
    content: string,
    sourcePlatform: string,
    targetPlatform: string
  ): Promise<string> {
    const system = `你是一个专业的跨平台内容适配专家。请将文章从"${sourcePlatform}"的风格适配为适合"${targetPlatform}"发布的风格。
要求：
1. 保持核心内容不变
2. 根据目标平台的风格调整语言和格式
3. 保留必要的 Markdown 格式
4. 直接输出适配后的内容，不要添加解释说明`

    const response = await this.chat([
      { role: 'system', content: system },
      { role: 'user', content },
    ])
    return response
  }
}

/**
 * AI 处理器工厂
 */
export type AIProcessorFactory = (config?: AIConfig) => AIProcessor

/**
 * 默认 AI 处理器实例（Noop）
 */
export const defaultAIProcessor: AIProcessor = new NoopAIProcessor()

/**
 * AI 处理器配置
 */
export interface AIConfig {
  provider?: 'openai' | 'claude' | 'local' | 'none'
  apiKey?: string
  baseUrl?: string
  model?: string
}

/**
 * 创建 AI 处理器
 * 传入有效的 AIConfig 时返回 OpenAIProcessor，否则返回 NoopAIProcessor
 */
export function createAIProcessor(config?: AIConfig): AIProcessor {
  if (config?.apiKey && config?.baseUrl) {
    return new OpenAIProcessor(config)
  }
  if (config?.apiKey) {
    return new OpenAIProcessor(config)
  }
  return new NoopAIProcessor()
}

/**
 * 检查配置是否可用于真实 AI 调用
 */
export function isAIConfigured(config?: AIConfig): boolean {
  return !!(config?.apiKey && config?.baseUrl)
}
