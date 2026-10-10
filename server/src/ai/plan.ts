import type { TrainingPlan } from '../../../src/types.ts'
import type { AiConfig } from './deepseek.ts'
import { chat, DeepSeekError } from './deepseek.ts'
import type { ChatMessage, RideFacts, RideFactsSource } from './prompt.ts'
import { buildRideFacts, renderFacts } from './prompt.ts'
import { ReviewFormatError, extractJsonObject } from './review.ts'
import { recordAiCall } from './metrics.ts'

/**
 * AI 训练计划：结合最近骑行数据与用户目标，规划当日 / 次日的骑行量。
 *
 * 与骑行复盘（coach.ts）同一套编排骨架：缓存 → 调用 → 校验 → 重试 → 降级。
 * 三处刻意的不同：
 *
 * 1. **降级产出的是"计划"而不是错误**。复盘降级时还能回落到记录里已有的规则建议，
 *    但"训练计划"在库里没有现成兜底 —— 所以这里现场算一份**保守的规则计划**
 *    （约最近骑行量的六成、轻松强度），并如实标注这是规则兜底而非 AI。
 *    空着一块卡片比给一份保守计划更糟：用户打开就是为了看"今天骑多少"。
 *
 * 2. **缓存键包含用户输入**。同一天改了目标或可用时间，就是另一份计划，
 *    必须重新生成；同输入重复查看则命中缓存、不再计费。
 *
 * 3. **没有心率/功率就不许编造**。现有数据里没有这两类指标，
 *    prompt 里明确要求强度只用「速度区间 + 自感用力（RPE）」表达 ——
 *    编一个"心率 150 以下"的指标，用户没法执行、还显得专业。
 */

/** 单次生成最多发起的请求数（首次 + 一次重试） */
const MAX_ATTEMPTS = 2
/** 缓存条数上限，超出后按插入顺序淘汰最早的 */
const CACHE_LIMIT = 50
/** 限流/超时后的退避时长 */
const RETRY_BACKOFF_MS = 600

/** 分段数量与各字段长度上限（超出截断，防止超长输出打爆前端） */
const MAX_HEADLINE = 120
const MAX_LABEL = 16
const MAX_DETAIL = 160
const MAX_REASON = 140
const MAX_PHASES = 5
const MIN_PHASES = 2
const MAX_REASONS = 3
const MAX_CAUTIONS = 3

/** 合法的强度档位。模型偶尔会造词，落回"耐力"并截短 */
const INTENSITY_LEVELS = ['恢复', '轻松', '耐力', '节奏', '阈值', '间歇'] as const

/** 训练计划的输入（经过路由层清洗） */
export interface PlanInputs {
  goal: string | null
  minutes: number | null
  day: 'today' | 'tomorrow'
}

/** 近 7 天训练量小计 —— 计划要参考"最近练了多少"，不只是"上一次" */
export interface RecentLoad {
  rides: number
  distanceKm: number
  durationMin: number
}

export interface PlanFacts {
  inputs: PlanInputs
  /** 最近一次骑行的事实（复用了复盘的 facts 结构，含历史对比） */
  lastRide: RideFacts | null
  recent: RecentLoad
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * 把最近的骑行列表 + 用户输入压成一份 facts。
 * 纯函数、不触网不读库，可被单元测试完整覆盖。
 * `today` 由调用方传入（YYYY-MM-DD），近 7 天窗口按日期字符串比较。
 */
export function buildPlanFacts(rides: RideFactsSource[], inputs: PlanInputs, today: string): PlanFacts {
  const lastRide = rides.length > 0 ? buildRideFacts(rides[0], rides.slice(1, 6)) : null

  // 近 7 天：按日期字符串比较即可（统一 YYYY-MM-DD 格式）
  const cutoff = new Date(Date.parse(`${today}T00:00:00`) - 6 * 86_400_000).toISOString().slice(0, 10)
  const recentRides = rides.filter((item) => item.date >= cutoff)
  const recent: RecentLoad = {
    rides: recentRides.length,
    distanceKm: round1(recentRides.reduce((sum, item) => sum + (item.distanceKm ?? 0), 0)),
    durationMin: Math.round(recentRides.reduce((sum, item) => sum + (item.durationMin ?? 0), 0)),
  }

  return { inputs, lastRide, recent }
}

/** 把计划输入与训练量渲染成紧凑文本（与 renderFacts 同风格：值为空整行省略） */
export function renderPlanFacts(facts: PlanFacts): string {
  const blocks: string[] = []

  const request = [
    `${facts.inputs.day === 'today' ? '计划日：今天' : '计划日：明天'}`,
    facts.inputs.goal ? `我的目标：${facts.inputs.goal}` : null,
    facts.inputs.minutes ? `可用时间：约 ${facts.inputs.minutes} 分钟` : null,
  ].filter(Boolean)
  blocks.push(`【计划请求】\n${request.join('\n')}`)

  if (facts.lastRide) {
    blocks.push(`【最近一次骑行（最主要的参考）】\n${renderFacts(facts.lastRide)}`)
  } else {
    blocks.push('【最近一次骑行】\n(还没有任何骑行记录)')
  }

  blocks.push(
    `【近 7 天训练量】\n骑行 ${facts.recent.rides} 次，共 ${facts.recent.distanceKm} km / ${facts.recent.durationMin} 分钟`
  )

  blocks.push(
    '【可用指标说明】\n数据里没有心率和功率，强度只用「速度区间 + 自感用力（1-10，能正常对话约为 4-5）」表达。'
  )

  return blocks.join('\n\n')
}

export const PLAN_SYSTEM_PROMPT = [
  '你是一名公路自行车教练，为骑行者规划当日或次日的训练安排。',
  '',
  '硬性要求：',
  '1. 只使用给定的数据。没有心率、功率数据，**禁止**给出心率/功率/踏频数值目标，',
  '   强度请用「速度区间 + 自感用力（RPE 1-10）」表达。',
  '2. 距离与时长要和"近 7 天训练量 + 最近一次骑行"匹配：',
  '   上次骑得多、最近很密 → 安排恢复或轻松骑；最近骑得少 → 可给适中负荷。',
  '   遵循渐进超负荷但不激进：单次量一般不超过最近一次骑行的 1.3 倍。',
  '3. 用户在【计划请求】里写了可用时间时，总时长**必须**不超过它。',
  '4. 结构分 2-5 段（热身 / 主课 / 放松 等），每段时长加起来等于总时长。',
  '5. 建议必须具体、可执行。禁止"注意安全""量力而行"这类空话。',
  '6. 全部用中文，语气直接、专业、不恭维。',
  '',
  '输出格式：',
  '只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字。结构如下：',
  '{',
  '  "headline": "一句话概括这次安排，40 字以内",',
  '  "intensity": "恢复/轻松/耐力/节奏/阈值/间歇 中选一个",',
  '  "distanceKm": 数字（km，保留一位小数）',
  '  "durationMin": 数字（分钟，整数）',
  '  "speedRange": "目标均速区间，如 24-27（km/h）"',
  '  "elevationM": 数字（建议累计爬升 m）或 null',
  '  "structure": [{"name": "热身", "durationMin": 15, "detail": "这一段具体怎么做，60 字以内"}],',
  '  "reasons": ["为什么这么安排，结合最近数据说明，1-3 条"],',
  '  "cautions": ["注意事项，0-3 条；确实是常规安排可以给空数组"]',
  '}',
].join('\n')

export function buildPlanMessages(facts: PlanFacts): ChatMessage[] {
  return [
    { role: 'system', content: PLAN_SYSTEM_PROMPT },
    { role: 'user', content: `请为我规划训练安排：\n\n${renderPlanFacts(facts)}\n\n请只返回 JSON。` },
  ]
}

/** 模型第一次返回的格式不合法时，追加一句纠正后重试 */
export function buildPlanRetryMessages(messages: ChatMessage[], reason: string): ChatMessage[] {
  return [
    ...messages,
    { role: 'assistant', content: '(上一次返回的内容不是合法 JSON)' },
    {
      role: 'user',
      content: `上一次的输出无法解析：${reason}\n请重新输出，且只输出一个 JSON 对象，不要代码块标记、不要多余文字。`,
    },
  ]
}

/* ============================ 校验层 ============================ */

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new ReviewFormatError(`${field} 不是字符串`)
  const text = value.trim()
  if (text === '') throw new ReviewFormatError(`${field} 是空的`)
  return text.length > max ? text.slice(0, max) : text
}

function requireNumber(value: unknown, field: string, min: number, max: number): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) throw new ReviewFormatError(`${field} 不是数字`)
  if (num < min || num > max) throw new ReviewFormatError(`${field} 超出合理范围（${num}）`)
  return num
}

function requireStringList(value: unknown, field: string, max: number, maxCount: number, atLeast: number): string[] {
  if (!Array.isArray(value)) throw new ReviewFormatError(`${field} 不是数组`)
  const items: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const text = raw.trim()
    if (text === '') continue
    items.push(text.length > max ? text.slice(0, max) : text)
    if (items.length >= maxCount) break
  }
  if (items.length < atLeast) throw new ReviewFormatError(`${field} 里没有有效内容`)
  return items
}

function requireStructure(value: unknown): TrainingPlan['structure'] {
  if (!Array.isArray(value)) throw new ReviewFormatError('structure 不是数组')
  const phases: TrainingPlan['structure'] = []
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const detail = typeof item.detail === 'string' ? item.detail.trim() : ''
    if (name === '' || detail === '') continue
    let durationMin: number
    try {
      durationMin = Math.round(requireNumber(item.durationMin, 'structure.durationMin', 1, 360))
    } catch {
      continue // 单段坏掉就跳过这一段，不因为一段拖垮整份计划
    }
    phases.push({
      name: name.length > MAX_LABEL ? name.slice(0, MAX_LABEL) : name,
      durationMin,
      detail: detail.length > MAX_DETAIL ? detail.slice(0, MAX_DETAIL) : detail,
    })
    if (phases.length >= MAX_PHASES) break
  }
  if (phases.length < MIN_PHASES) throw new ReviewFormatError('structure 里有效的分段不足 2 段')
  return phases
}

/**
 * 解析并校验模型返回的训练计划。
 * 任何不满足结构的地方都抛 ReviewFormatError（上层据此重试一次，再失败就规则兜底）。
 */
export function parseTrainingPlan(raw: string): TrainingPlan {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJsonObject(raw))
  } catch (err) {
    if (err instanceof ReviewFormatError) throw err
    throw new ReviewFormatError(`JSON 解析失败：${err instanceof Error ? err.message : String(err)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ReviewFormatError('顶层不是 JSON 对象')
  }
  const obj = parsed as Record<string, unknown>

  const intensityRaw = requireText(obj.intensity, 'intensity', MAX_LABEL)
  const intensity = (INTENSITY_LEVELS as readonly string[]).includes(intensityRaw) ? intensityRaw : '耐力'

  const elevationRaw = obj.elevationM
  const elevationM =
    elevationRaw == null ? null : Math.round(requireNumber(elevationRaw, 'elevationM', 0, 5000))

  return {
    headline: requireText(obj.headline, 'headline', MAX_HEADLINE),
    intensity,
    distanceKm: round1(requireNumber(obj.distanceKm, 'distanceKm', 1, 500)),
    durationMin: Math.round(requireNumber(obj.durationMin, 'durationMin', 5, 600)),
    speedRange: requireText(obj.speedRange, 'speedRange', MAX_LABEL),
    elevationM,
    structure: requireStructure(obj.structure),
    reasons: requireStringList(obj.reasons, 'reasons', MAX_REASON, MAX_REASONS, 1),
    cautions: requireStringList(obj.cautions, 'cautions', MAX_REASON, MAX_CAUTIONS, 0),
  }
}

/** 模型给出的时长若突破用户的时间约束，截到约束内（这条由服务端兜底，不指望模型自觉） */
export function clampPlanToInputs(plan: TrainingPlan, inputs: PlanInputs): TrainingPlan {
  if (inputs.minutes == null || plan.durationMin <= inputs.minutes) return plan
  return { ...plan, durationMin: inputs.minutes }
}

/* ============================ 规则兜底 ============================ */

/**
 * AI 不可用时的保守计划：约为最近一次骑行量的六成、轻松强度。
 * 刻意简单 —— 它的职责是"别让这一块空着"，而不是成为第二个教练。
 */
export function buildRulePlan(facts: PlanFacts): TrainingPlan {
  const last = facts.lastRide
  const baseMinutes = last?.durationMin ?? 45

  let durationMin = Math.max(20, Math.round((baseMinutes * 0.6) / 5) * 5)
  if (facts.inputs.minutes != null) durationMin = Math.min(durationMin, facts.inputs.minutes)
  // 轻松骑按 18 km/h 折算距离，与时长自洽
  const distanceKm = round1(Math.max(5, (durationMin / 60) * 18))

  const warm = Math.max(5, Math.round(durationMin * 0.2))
  const cool = Math.max(5, Math.round(durationMin * 0.15))
  const main = Math.max(5, durationMin - warm - cool)

  return {
    headline: `轻松骑 ${durationMin} 分钟，保持活动量、不加负荷`,
    intensity: '轻松',
    distanceKm,
    durationMin,
    speedRange: '16-20',
    elevationM: null,
    structure: [
      { name: '热身', durationMin: warm, detail: '小齿比慢骑，让身体热起来，不追求速度' },
      { name: '主课', durationMin: main, detail: '全程轻松强度：能正常对话、呼吸不急促，起伏路段不发力' },
      { name: '放松', durationMin: cool, detail: '降速溜车，结束后拉伸小腿与大腿前侧' },
    ],
    reasons: [
      facts.lastRide
        ? `AI 暂不可用，按保守规则给出：约为最近一次（${last?.distanceKm ?? '—'} km）的六成，保持活动量而不增加负荷`
        : 'AI 暂不可用，按保守规则给出：还没有骑行记录，先用一次轻松骑找找状态',
      '等 AI 恢复后重新生成，可以得到贴合目标的安排',
    ],
    cautions: ['强度以自感用力为准：全程能正常对话即为轻松；一旦觉得吃力就再放慢'],
  }
}

/* ============================ 编排层 ============================ */

export interface PlanOutcome {
  plan: TrainingPlan
  source: 'model' | 'fallback'
  cached: boolean
  fallbackReason: string | null
  usage: { promptTokens: number; completionTokens: number } | null
  durationMs: number
  attempts: number
  promptChars: number
}

interface CacheEntry {
  plan: TrainingPlan
  usage: { promptTokens: number; completionTokens: number }
}

const cache = new Map<string, CacheEntry>()

/**
 * 缓存键 = 用户输入（目标/时间/计划日）+ 最近一次记录的 id@updatedAt。
 * 输入变化或记录更新（新骑了一次、改了数据）都会自然失效。
 */
export function planCacheKey(inputs: PlanInputs, latest: { id: string; updatedAt: number } | undefined): string {
  const latestKey = latest ? `${latest.id}@${latest.updatedAt}` : 'none'
  return `${inputs.day}|${inputs.minutes ?? '-'}|${inputs.goal ?? '-'}|${latestKey}`
}

/** 测试用：清空缓存，避免用例之间互相影响 */
export function clearPlanCache(): void {
  cache.clear()
}

export function planCacheSize(): number {
  return cache.size
}

function readCache(key: string): CacheEntry | null {
  const hit = cache.get(key)
  if (!hit) return null
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

export interface PlanDeps {
  /** 注入 fetch 让测试不必联网 */
  fetchImpl?: typeof fetch
  /** 注入 sleep 让测试不必真的等退避 */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 生成（或从缓存取出）一份训练计划。
 *
 * 与复盘一样：**任何情况下都不抛错** —— 失败时回落到现场计算的保守规则计划，
 * 并在 fallbackReason 里如实说明原因。用户总能拿到一个"今天骑多少"的答案。
 */
export async function generateTrainingPlan(
  config: AiConfig,
  facts: PlanFacts,
  cacheKey: string,
  deps: PlanDeps = {}
): Promise<PlanOutcome> {
  const startedAt = Date.now()
  const promptChars = renderPlanFacts(facts).length

  const hit = readCache(cacheKey)
  if (hit) {
    return {
      plan: hit.plan,
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
  const baseMessages = buildPlanMessages(facts)
  let messages = baseMessages
  let attempts = 0
  let lastError = '未知原因'

  for (let round = 0; round < MAX_ATTEMPTS; round += 1) {
    attempts += 1
    try {
      const outcome = await chat(config, messages, { json: true, maxTokens: 900 }, deps.fetchImpl)
      const plan = clampPlanToInputs(parseTrainingPlan(outcome.content), facts.inputs)
      const usage = { promptTokens: outcome.promptTokens, completionTokens: outcome.completionTokens }
      writeCache(cacheKey, { plan, usage })
      const durationMs = Date.now() - startedAt
      recordAiCall({
        at: new Date().toISOString(),
        kind: 'plan',
        ok: true,
        attempts,
        durationMs,
        ...usage,
        error: null,
      })
      return { plan, source: 'model', cached: false, fallbackReason: null, usage, durationMs, attempts, promptChars }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      const canRetry = round + 1 < MAX_ATTEMPTS
      if (!canRetry) break

      if (err instanceof ReviewFormatError) {
        messages = buildPlanRetryMessages(baseMessages, lastError)
      } else if (err instanceof DeepSeekError && !err.retryable) {
        break
      } else {
        await sleep(RETRY_BACKOFF_MS)
      }
    }
  }

  const durationMs = Date.now() - startedAt
  recordAiCall({
    at: new Date().toISOString(),
    kind: 'plan',
    ok: false,
    attempts,
    durationMs,
    promptTokens: 0,
    completionTokens: 0,
    error: lastError,
  })

  return {
    plan: buildRulePlan(facts),
    source: 'fallback',
    cached: false,
    fallbackReason: lastError,
    usage: null,
    durationMs,
    attempts,
    promptChars,
  }
}
