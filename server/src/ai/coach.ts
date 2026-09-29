import type { AiConfig } from './deepseek.ts'
import { chat, DeepSeekError } from './deepseek.ts'
import type { RideFacts } from './prompt.ts'
import { buildMessages, buildRetryMessages, renderFacts } from './prompt.ts'
import type { CoachReview } from './review.ts'
import { parseCoachReview, ReviewFormatError } from './review.ts'
import { recordAiCall } from './metrics.ts'

/**
 * 骑行复盘的编排层：缓存 → 调用 → 校验 → 重试 → 降级。
 *
 * 这里是「让 AI 功能能被信赖」的关键部分。三件事必须做对：
 *
 * 1. **失败降级**：模型超时、限流、返回格式不对，都不能让用户看到一个空白卡片。
 *    降级不是返回错误，而是回落到已有的规则引擎 —— 记录里本来就存着
 *    `comment` 与 `suggestions`，所以兜底内容不需要额外请求、也不需要模型。
 *
 * 2. **格式错误重试**：把「上一次不合法 + 具体要求」追加一轮，让模型自己纠正。
 *    实测这比换一套 prompt 有效得多，因为模型能看到自己错在哪。
 *    但**只重试一次** —— 同一份数据反复重试只是烧钱，问题通常在模型侧。
 *
 * 3. **不重复调用**：同一条记录（按 `id@updatedAt` 判定）只生成一次。
 *    记录被编辑后 updatedAt 变化，缓存自然失效。
 */

/** 单次复盘最多发起的请求数（首次 + 一次重试） */
const MAX_ATTEMPTS = 2
/** 缓存条数上限，超出后按插入顺序淘汰最早的 */
const CACHE_LIMIT = 100
/** 限流/超时后的退避时长 */
const RETRY_BACKOFF_MS = 600

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
}

export interface CoachOutcome {
  /** 模型给出的复盘；降级时为 null，由前端回落到记录里已有的规则建议 */
  review: CoachReview | null
  source: 'model' | 'fallback'
  /** 命中缓存时为 true（不再计费） */
  cached: boolean
  /** 降级的直接原因，用于向用户解释以及写入日志 */
  fallbackReason: string | null
  usage: TokenUsage | null
  durationMs: number
  attempts: number
  /** prompt 的字符数 —— 用于在界面上说明「压缩前 vs 压缩后」 */
  promptChars: number
}

interface CacheEntry {
  review: CoachReview
  usage: TokenUsage
}

const cache = new Map<string, CacheEntry>()

/**
 * 缓存键 = 记录 id + 最后修改时间。
 * 只按 id 缓存是不行的：用户改了距离或剔除了脏轨迹点后，复盘必须重新生成。
 */
export function coachCacheKey(rideId: string, updatedAt: number): string {
  return `${rideId}@${updatedAt}`
}

/** 测试用：清空缓存，避免用例之间互相影响 */
export function clearCoachCache(): void {
  cache.clear()
}

export function coachCacheSize(): number {
  return cache.size
}

function readCache(key: string): CacheEntry | null {
  const hit = cache.get(key)
  if (!hit) return null
  // 触碰一下，让它排到队尾（Map 保持插入顺序 → 天然的 LRU）
  cache.delete(key)
  cache.set(key, hit)
  return hit
}

function writeCache(key: string, entry: CacheEntry): void {
  cache.set(key, entry)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export interface CoachDeps {
  /** 注入 fetch 让测试不必联网 */
  fetchImpl?: typeof fetch
  /** 注入 sleep 让测试不必真的等退避 */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 生成（或从缓存取出）一次骑行的复盘。
 *
 * 注意：**任何情况下都不抛错**。AI 只是增强，不该成为整条链路的单点故障 ——
 * 拿到 fallback 时前端照常渲染记录里已有的规则建议，用户只是少了一段个性化点评。
 */
export async function generateCoachReview(
  config: AiConfig,
  facts: RideFacts,
  cacheKey: string,
  deps: CoachDeps = {}
): Promise<CoachOutcome> {
  const startedAt = Date.now()
  const promptChars = renderFacts(facts).length

  const hit = readCache(cacheKey)
  if (hit) {
    return {
      review: hit.review,
      source: 'model',
      cached: true,
      fallbackReason: null,
      usage: hit.usage,
      durationMs: 0,
      attempts: 0,
      promptChars,
    }
  }

  const sleep = deps.sleep ?? defaultSleep
  const baseMessages = buildMessages(facts)
  let messages = baseMessages
  let attempts = 0
  let lastError = '未知原因'

  for (let round = 0; round < MAX_ATTEMPTS; round += 1) {
    attempts += 1
    try {
      const outcome = await chat(config, messages, { json: true }, deps.fetchImpl)
      const review = parseCoachReview(outcome.content)
      const usage: TokenUsage = {
        promptTokens: outcome.promptTokens,
        completionTokens: outcome.completionTokens,
      }
      writeCache(cacheKey, { review, usage })
      const durationMs = Date.now() - startedAt
      recordAiCall({
        at: new Date().toISOString(),
        kind: 'coach',
        ok: true,
        attempts,
        durationMs,
        ...usage,
        error: null,
      })
      return {
        review,
        source: 'model',
        cached: false,
        fallbackReason: null,
        usage,
        durationMs,
        attempts,
        promptChars,
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      const canRetry = round + 1 < MAX_ATTEMPTS
      if (!canRetry) break

      if (err instanceof ReviewFormatError) {
        // 格式问题立刻重试：这不是服务端压力，等一会儿没有意义
        messages = buildRetryMessages(baseMessages, lastError)
      } else if (err instanceof DeepSeekError && !err.retryable) {
        // 401/402/403 是配置问题，重试只是白花时间
        break
      } else {
        // 限流 / 5xx / 超时：等一会儿再试
        await sleep(RETRY_BACKOFF_MS)
      }
    }
  }

  const durationMs = Date.now() - startedAt
  recordAiCall({
    at: new Date().toISOString(),
    kind: 'coach',
    ok: false,
    attempts,
    durationMs,
    promptTokens: 0,
    completionTokens: 0,
    error: lastError,
  })

  return {
    review: null,
    source: 'fallback',
    cached: false,
    fallbackReason: lastError,
    usage: null,
    durationMs,
    attempts,
    promptChars,
  }
}
