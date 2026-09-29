/**
 * AI 调用的可观测性。
 *
 * 只记「调用事实」，不记内容 —— 骑行数据属于个人信息，日志里不该出现，
 * 更不该出现 API Key（这个类里压根拿不到它）。
 *
 * 用途有三个：
 *   1. 排查线上问题：模型是超时了、限流了，还是返回格式不对
 *   2. 成本核算：累计 token 数
 *   3. 面试/答辩时可讲：这是「AI 应用」和「调通 API」的区别之一
 *
 * 存储刻意用内存环形缓冲：AI 调用频率低（一次骑行一次），
 * 为此建表写库不值得；重启丢失也无所谓 —— 它服务于「看最近发生了什么」。
 */

export interface AiCallLog {
  at: string
  /** 调用场景，目前只有骑行复盘 */
  kind: 'coach'
  ok: boolean
  /** 实际发起了几次请求（格式错误会重试） */
  attempts: number
  durationMs: number
  promptTokens: number
  completionTokens: number
  /** 失败原因摘要（已剔除可能包含密钥的内容） */
  error: string | null
}

const LIMIT = 50
const logs: AiCallLog[] = []

export function recordAiCall(log: AiCallLog): void {
  logs.unshift(log)
  if (logs.length > LIMIT) logs.length = LIMIT
}

/** 最近的调用，由新到旧 */
export function recentAiCalls(): AiCallLog[] {
  return [...logs]
}

/** 测试用：清空记录，避免用例之间互相污染 */
export function clearAiCalls(): void {
  logs.length = 0
}

export interface AiStats {
  total: number
  ok: number
  failed: number
  /** 失败率，0~1 */
  failRate: number
  avgDurationMs: number
  promptTokens: number
  completionTokens: number
}

export function aiCallStats(): AiStats {
  const total = logs.length
  const ok = logs.filter((item) => item.ok).length
  const promptTokens = logs.reduce((sum, item) => sum + item.promptTokens, 0)
  const completionTokens = logs.reduce((sum, item) => sum + item.completionTokens, 0)
  const duration = logs.reduce((sum, item) => sum + item.durationMs, 0)
  return {
    total,
    ok,
    failed: total - ok,
    failRate: total === 0 ? 0 : Math.round(((total - ok) / total) * 100) / 100,
    avgDurationMs: total === 0 ? 0 : Math.round(duration / total),
    promptTokens,
    completionTokens,
  }
}
