import type { CoachReview } from '../../../src/types.ts'

/**
 * 结构化输出的校验层。
 *
 * 大模型返回的 JSON 只能当“不可信输入”对待 —— 它会漏字段、把数组写成字符串、
 * 在 JSON 外面裹一层 ```json、或者在对象后面多写一段解释。
 * 所以这里做三件事：
 *   1. 容错提取：剥掉代码块标记，截取最外层的 {...}
 *   2. 严格校验：逐字段检查类型与长度，任何一项不合格就抛错（交给上层重试或降级）
 *   3. 截断保护：超长字段直接截断，避免一句跑飞的话把前端布局撑破
 *
 * 校验失败**不返回半成品**。宁可降级到规则引擎，也不要给用户看一个缺字段的卡片。
 *
 * `CoachReview` 的形状定义在前端 `src/types.ts` —— 前端要渲染它，后端要产出它，
 * 共用一份定义才不会漂移（与项目其它模型的处理方式一致）。
 */

/** 字段长度上限（超出截断，同时防止 prompt 注入式的超长输出打爆前端） */
const MAX_SUMMARY = 120
const MAX_ITEM = 80
const MAX_HOW = 140
const MAX_ITEMS = 3

export type { CoachReview }

export class ReviewFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReviewFormatError'
  }
}

/** 剥掉 ```json 包裹与前后废话，取出最外层的 JSON 对象文本 */
export function extractJsonObject(raw: string): string {
  const text = raw.trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new ReviewFormatError('返回内容里没有 JSON 对象')
  }
  return text.slice(start, end + 1)
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new ReviewFormatError(`${field} 不是字符串`)
  const text = value.trim()
  if (text === '') throw new ReviewFormatError(`${field} 是空的`)
  return text.length > max ? text.slice(0, max) : text
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new ReviewFormatError(`${field} 不是字符串`)
  const text = value.trim()
  if (text === '' || text === 'null' || text === '无') return null
  return text.length > max ? text.slice(0, max) : text
}

/** 字符串数组：**先过滤掉无效项再取前 MAX_ITEMS 条**，至少要剩一条 */
function requireStringList(value: unknown, field: string, max: number): string[] {
  if (!Array.isArray(value)) throw new ReviewFormatError(`${field} 不是数组`)
  const items: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const text = raw.trim()
    if (text === '') continue
    items.push(text.length > max ? text.slice(0, max) : text)
    if (items.length >= MAX_ITEMS) break
  }
  if (items.length === 0) throw new ReviewFormatError(`${field} 里没有有效内容`)
  return items
}

function requireImprovements(value: unknown): { point: string; how: string }[] {
  if (!Array.isArray(value)) throw new ReviewFormatError('improvements 不是数组')
  const items: { point: string; how: string }[] = []
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    // 模型偶尔会把 point/how 合成一个字符串，那种项直接跳过
    if (typeof item.point !== 'string' || typeof item.how !== 'string') continue
    const point = item.point.trim()
    const how = item.how.trim()
    if (point === '' || how === '') continue
    items.push({
      point: point.length > MAX_ITEM ? point.slice(0, MAX_ITEM) : point,
      how: how.length > MAX_HOW ? how.slice(0, MAX_HOW) : how,
    })
    if (items.length >= MAX_ITEMS) break
  }
  if (items.length === 0) throw new ReviewFormatError('improvements 里没有有效条目')
  return items
}

/**
 * 解析并校验模型返回的复盘。
 * 任何不满足结构的地方都抛 ReviewFormatError（上层据此重试一次，再失败就降级）。
 */
export function parseCoachReview(raw: string): CoachReview {
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

  return {
    summary: requireText(obj.summary, 'summary', MAX_SUMMARY),
    highlights: requireStringList(obj.highlights, 'highlights', MAX_ITEM),
    improvements: requireImprovements(obj.improvements),
    nextGoal: requireText(obj.nextGoal, 'nextGoal', MAX_ITEM),
    risk: optionalText(obj.risk, 'risk', MAX_ITEM),
  }
}
