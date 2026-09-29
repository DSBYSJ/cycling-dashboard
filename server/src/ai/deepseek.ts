import type { ChatMessage } from './prompt.ts'

/**
 * DeepSeek Chat Completions 客户端。
 *
 * 刻意只用 fetch，不引官方 SDK —— 与后端「零原生模块、依赖越少越好」的一贯取舍一致
 * （第三方 SDK 会按月悄悄升级，而这里要的只是一次 POST）。
 *
 * ⚠️ 安全约定：错误信息里**绝不能出现 API Key**。
 * 所有抛出的错误都只带 HTTP 状态码与脱敏后的服务端提示。
 */

export interface AiConfig {
  /** 未配置时为 null —— 此时 AI 功能整体不可用，但服务照常运行 */
  apiKey: string | null
  baseUrl: string
  model: string
  timeoutMs: number
}

export interface ChatOutcome {
  content: string
  promptTokens: number
  completionTokens: number
}

export class DeepSeekError extends Error {
  readonly status: number | null
  /** 是否属于「等一会儿再试可能就好」的错误（限流、5xx、超时、网络抖动） */
  readonly retryable: boolean

  constructor(message: string, status: number | null, retryable: boolean) {
    super(message)
    this.name = 'DeepSeekError'
    this.status = status
    this.retryable = retryable
  }
}

/** 只保留服务端错误体里的短提示，且剥掉任何疑似密钥的片段 */
function safeDetail(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, 200)
  return trimmed.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  /** 要求返回 JSON 对象。DeepSeek 走 OpenAI 兼容协议，靠 response_format 约束 */
  json?: boolean
}

/**
 * 发起一次对话补全。
 * fetchImpl 可注入，让单元测试不必真的联网（也不会因为网络抖动而变成 flaky 测试）。
 */
export async function chat(
  config: AiConfig,
  messages: ChatMessage[],
  options: ChatOptions = {},
  fetchImpl: typeof fetch = fetch
): Promise<ChatOutcome> {
  if (!config.apiKey) {
    throw new DeepSeekError('未配置 DEEPSEEK_API_KEY', null, false)
  }

  let response: Response
  try {
    response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 800,
        stream: false,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (err) {
    // 超时（AbortSignal.timeout 抛 TimeoutError）与网络错误都属于可重试
    const name = err instanceof Error ? err.name : ''
    const message = err instanceof Error ? err.message : String(err)
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new DeepSeekError(`请求超时（${config.timeoutMs}ms）`, null, true)
    }
    throw new DeepSeekError(`网络错误：${safeDetail(message)}`, null, true)
  }

  if (!response.ok) {
    let detail = ''
    try {
      detail = safeDetail(await response.text())
    } catch {
      detail = ''
    }
    // 429 限流与 5xx 服务端故障可重试；401/402/403 是配置问题，重试没有意义
    const retryable = response.status === 429 || response.status >= 500
    throw new DeepSeekError(`上游返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`, response.status, retryable)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new DeepSeekError('上游返回的不是合法 JSON', response.status, true)
  }

  const payload = data as {
    choices?: { message?: { content?: unknown } }[]
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
  }
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw new DeepSeekError('上游返回内容为空', response.status, true)
  }

  const promptTokens = Number(payload.usage?.prompt_tokens)
  const completionTokens = Number(payload.usage?.completion_tokens)

  return {
    content,
    promptTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
    completionTokens: Number.isFinite(completionTokens) ? completionTokens : 0,
  }
}
