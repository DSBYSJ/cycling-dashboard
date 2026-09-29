import type { RideFacts } from '../src/ai/prompt.ts'
import type { CoachReview } from '../src/ai/review.ts'

/**
 * 输出质量检查（评测集的判定逻辑）。
 *
 * 为什么需要它：**改 prompt 是会改坏的。** 调一句措辞让 A 用例变好，很可能让 B 用例变差，
 * 而凭感觉根本看不出来 —— 你只会记得最近一次试得很顺的那个。
 * 所以需要一组固定输入 + 自动判定，每次改完跑一遍，看有没有退步。
 *
 * 这些检查是**启发式的**，不是人工评分，所以它们能抓住"明显退步"，
 * 抓不住"文风是不是更好"。诚实地说清这个边界，比假装它是严谨评估要好。
 *
 * 全部是纯函数 —— 不联网、不调模型，可以对着一份固定的模型输出反复验证判定逻辑本身。
 */

export interface EvalCase {
  id: string
  /** 这条用例想考什么。写明意图，否则半年后没人知道为什么留着它 */
  intent: string
  facts: RideFacts
}

export interface CheckResult {
  name: string
  passed: boolean
  detail: string
}

/**
 * 空洞套话黑名单。
 * 模型在数据不足时最爱写这些 —— 它们在任何一次骑行里都成立，因此等于没写。
 * 这份清单本身就是"什么是废话"的可执行定义。
 */
export const CLICHES = [
  '注意安全',
  '多加练习',
  '保持良好心态',
  '继续努力',
  '量力而行',
  '循序渐进',
  '根据自己的情况',
  '因人而异',
  '合理饮食',
  '早睡早起',
  '贵在坚持',
]

/**
 * 可执行信号：出现数字，或出现这些动词之一，才认为建议落到了动作上。
 *
 * ⚠️ 这份词表是**用真实输出反复补出来的**，别凭想象写：
 * 第一版只有十几个词，结果把「下次**记录**该段距离与持续时间」
 * 「下次**使用**码表记录基础数据」都判成了"过于笼统" ——
 * 而这两条恰恰是数据稀疏时最该给的建议，方向完全正确。
 *
 * 也要清楚它的局限：**关键词法抓不住语义**。它只能当粗筛，
 * 用来抓"根据自己的情况循序渐进，贵在坚持"这种完全没有动作的废话。
 */
const ACTION_WORDS = [
  '补',
  '带',
  '备',
  '换',
  '选',
  '改',
  '加',
  '减',
  '降低',
  '提高',
  '缩短',
  '延长',
  '提前',
  '后移',
  '避开',
  '增加',
  '减少',
  '控制在',
  '保持',
  '分配',
  '安排',
  '记录',
  '使用',
  '佩戴',
  '测量',
  '确认',
  '对比',
  '复查',
  '检查',
  '调整',
  '做',
  '练',
  '完成',
  '尝试',
  '每',
  '不要超过',
]

/**
 * 无论什么语境都不该出现的词 —— 它们暗示模型知道用户的**背景信息**，
 * 而输入里只有骑行数据，没有任何背景（车型、装备、同伴）。
 */
export const BACKGROUND_FABRICATION = ['你的车胎', '轮胎型号', '组队', '你跟谁', '你的车是', '你的装备']

/**
 * 专业术语：**本身不是编造**。
 *
 * ⚠️ 这条规则是**拿真实模型跑出来的教训**。第一版把这些词直接当编造关键词，
 * 结果 6 个用例全部误判失败 —— 而模型的建议其实相当到位：
 *   ·「平路段保持踏频 85-95 转/分」→ 这是建议，不是声称数据里有踏频
 *   ·「用码表记录时长、均速、爬升」→ 这是建议补数据，恰恰是数据稀疏时该做的事
 *
 * 所以正确的判据不是「提到了什么词」，而是**以什么姿态提到**：
 * 陈述事实（"这次平均心率 152"）才算编造；给建议（"把心率压在 140 以下"）不算。
 */
export const METRIC_TERMS = ['心率', '踏频', '功率', '瓦特', 'FTP', '乳酸阈', '配速区间']

/**
 * 指代「已发生的事实」的标记。
 *
 * 编造 = **断言本次骑行的某个未测量指标**，所以只有出现这些标记才判定。
 * 这是第二版判据：第一版看"前面有没有建议动词"，仍然误判了
 * 「用低踏频爬坡」「高踏频间歇」—— 中文里"形容词 + 术语"根本不需要动词。
 * 改成找"断言标记"后，「你这次平均心率 152」会被抓住，
 * 而「低/高踏频」这类构词不会再被冤枉。
 *
 * ⚠️ 代价是**会漏判**没有指示词的裸断言（如"心率 152"）。这里刻意选择宁可漏判：
 * 误判会让整份评测报告说谎，漏判只是少抓一条 —— 两者不对称。
 * 真正兜住编造的其实是下面那条「带数值提及缺失维度」，它不依赖措辞。
 */
const CLAIM_MARKERS = ['本次', '这次', '你的', '你这次', '数据显示', '记录显示', '实测', '统计显示']

/** 术语前 10 个字符内是否出现「断言已发生事实」的标记 */
function hasClaimMarker(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 10), index)
  return CLAIM_MARKERS.some((word) => before.includes(word))
}

/**
 * 从 facts 里抽出"可以拿来引用"的数字，用于判断模型是否真的读了数据。
 *
 * ⚠️ 这里有两个必须防的假阳性，都是实测踩出来的：
 *   1. **裸子串匹配会误中** —— 简单 `text.includes('3')` 会被 "33.5" 命中，
 *      于是任何输出都能"引用成功"，检查形同虚设。所以用词边界匹配（见 mentionsNumber）。
 *   2. **个位数没有区分力** —— 风力 3 级、AQI 0 这种个位数在自然语言里到处都是，
 *      偶然命中概率极高。所以只保留至少两位有效数字的项。
 */
export function numericTokens(facts: RideFacts): string[] {
  const values = [
    facts.distanceKm,
    facts.avgSpeed,
    facts.maxSpeed,
    facts.elevationGain,
    facts.avgGrade,
    facts.temperature,
    facts.humidity,
    facts.windLevel,
    facts.precipitation,
    facts.aqi,
    facts.scores?.total,
  ]
  return values
    .filter((value): value is number => value !== null && value !== undefined)
    .map((value) => String(value))
    .filter((token) => token.replace(/[^\d]/g, '').length >= 2)
}

/**
 * 文本里是否"作为一个独立数字"出现了 token。
 * 用 lookaround 排除前后紧邻数字或小数点的情况，避免 3 命中 33.5、12 命中 62.4。
 */
export function mentionsNumber(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`).test(text)
}

/** 把一条复盘拼成便于检查的整段文本 */
export function reviewText(review: CoachReview): string {
  return [
    review.summary,
    ...review.highlights,
    ...review.improvements.flatMap((item) => [item.point, item.how]),
    review.nextGoal,
    review.risk ?? '',
  ].join('\n')
}

/** 检查 1：不能出现任何一条空洞套话 */
export function checkNoCliches(review: CoachReview): CheckResult {
  const text = reviewText(review)
  const hit = CLICHES.filter((word) => text.includes(word))
  return {
    name: '无空洞套话',
    passed: hit.length === 0,
    detail: hit.length === 0 ? '未出现黑名单中的套话' : `出现套话：${hit.join('、')}`,
  }
}

/**
 * 检查 2：至少引用一个输入里出现过的数字。
 * 这是"模型真的读了数据"最便宜的强信号 —— 泛泛而谈的回答引用不出 33.5℃ 或 412m。
 */
export function checkCitesData(caseItem: EvalCase, review: CoachReview): CheckResult {
  const tokens = numericTokens(caseItem.facts)
  const text = reviewText(review)
  const hit = tokens.filter((token) => mentionsNumber(text, token))
  const sample = tokens.slice(0, 8).join('/')
  return {
    name: '引用具体数据',
    passed: hit.length > 0,
    detail:
      hit.length === 0
        ? `未引用任何数据（可用数值：${sample}${tokens.length > 8 ? ' 等' : ''}）`
        : `引用了 ${hit.slice(0, 6).join('、')}`,
  }
}

/**
 * 检查 2：不得**带着具体数值**提及输入里根本没有的维度。
 *
 * 为什么要求"带数值"：编造的本质是给出输入里没有的数字。
 * 单纯建议「记得记录爬升」是好事，不该判失败 —— 这条同样是从真实模型的输出里修正来的
 * （原版只要提到"爬升"就算编造，而模型的输出是"下次补齐时长、均速、爬升"）。
 */
function mentionsValueNear(text: string, pattern: RegExp, window = 12): boolean {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const re = new RegExp(pattern.source, flags)
  let match: RegExpExecArray | null = re.exec(text)
  while (match !== null) {
    const end = match.index + match[0].length
    const after = text.slice(end, end + window)
    const before = text.slice(Math.max(0, match.index - window), match.index)
    if (/\d/.test(after) || /\d/.test(before)) return true
    if (match[0].length === 0) re.lastIndex += 1
    match = re.exec(text)
  }
  return false
}

export function checkMissingDimensions(caseItem: EvalCase, review: CoachReview): CheckResult {
  const facts = caseItem.facts
  const text = reviewText(review)
  const invented: string[] = []

  if (facts.temperature === null && mentionsValueNear(text, /℃|摄氏|气温|温度/)) invented.push('气温')
  if (facts.aqi === null && mentionsValueNear(text, /AQI|空气质量/i)) invented.push('空气质量')
  if (facts.humidity === null && mentionsValueNear(text, /湿度/)) invented.push('湿度')
  if (facts.windLevel === null && mentionsValueNear(text, /风力|风速/)) invented.push('风力')
  if (facts.elevationGain === null && facts.avgGrade === null && mentionsValueNear(text, /爬升|坡度/))
    invented.push('爬升')
  if (facts.precipitation === null && mentionsValueNear(text, /降雨|降水|下雨/)) invented.push('降雨')

  return {
    name: '未提及缺失维度',
    passed: invented.length === 0,
    detail: invented.length === 0 ? '未带数值提及输入里缺失的维度' : `输入里没有却报了数：${invented.join('、')}`,
  }
}

/** 检查 5：每条改进建议都要落到可执行的动作上 */
export function checkActionable(review: CoachReview): CheckResult {
  const weak = review.improvements.filter((item) => {
    const how = item.how
    const hasNumber = /\d/.test(how)
    const hasAction = ACTION_WORDS.some((word) => how.includes(word))
    return !hasNumber && !hasAction
  })
  return {
    name: '建议可执行',
    passed: weak.length === 0,
    detail: weak.length === 0 ? '每条建议都含数字或明确动作' : `过于笼统：${weak.map((item) => item.point).join('、')}`,
  }
}

/**
 * 检查 4：不能以**陈述事实**的口吻断言输入里根本不存在的指标。
 *
 * 判据是"姿态"而不是"词"：模型在建议里说「保持踏频 85-95」完全正常，
 * 说「你这次平均心率 152」才是编造 —— 输入里没有任何心率数据。
 */
export function checkNoFabrication(review: CoachReview): CheckResult {
  const text = reviewText(review)
  const hits: string[] = []

  for (const term of BACKGROUND_FABRICATION) {
    if (text.includes(term)) hits.push(term)
  }

  for (const term of METRIC_TERMS) {
    const re = new RegExp(term, 'gi')
    let match: RegExpExecArray | null = re.exec(text)
    while (match !== null) {
      // 没有"这次/你的"这类断言标记，就默认它在给建议，放过
      if (!hasClaimMarker(text, match.index)) {
        match = re.exec(text)
        continue
      }
      hits.push(term)
      break
    }
  }

  const unique = [...new Set(hits)]
  return {
    name: '未编造信息',
    passed: unique.length === 0,
    detail: unique.length === 0 ? '未以陈述口吻断言输入之外的指标' : `凭空断言：${unique.join('、')}`,
  }
}

/**
 * 检查 6：篇幅落在合理区间。
 * 太短通常是敷衍（"骑得不错"），太长通常是模型在凑字数 —— 两者都不算好输出。
 */
export function checkLength(review: CoachReview): CheckResult {
  const problems: string[] = []
  if (review.summary.length < 8) problems.push('summary 过短')
  if (review.summary.length > 120) problems.push('summary 过长')
  if (review.highlights.length > 3) problems.push('highlights 超过 3 条')
  if (review.improvements.length > 3) problems.push('improvements 超过 3 条')
  if (review.nextGoal.length < 4) problems.push('nextGoal 过短')
  return {
    name: '篇幅合理',
    passed: problems.length === 0,
    detail: problems.length === 0 ? '各字段长度均在区间内' : problems.join('；'),
  }
}

export const CHECK_NAMES = [
  '未编造信息',
  '未提及缺失维度',
  '无空洞套话',
  '引用具体数据',
  '建议可执行',
  '篇幅合理',
]

export function runChecks(caseItem: EvalCase, review: CoachReview): CheckResult[] {
  return [
    checkNoFabrication(review),
    checkMissingDimensions(caseItem, review),
    checkNoCliches(review),
    checkCitesData(caseItem, review),
    checkActionable(review),
    checkLength(review),
  ]
}

export interface CaseReport {
  caseId: string
  intent: string
  source: 'model' | 'fallback'
  attempts: number
  durationMs: number
  promptTokens: number
  completionTokens: number
  checks: CheckResult[]
  review: CoachReview | null
  error: string | null
}

export interface EvalSummary {
  total: number
  passedCases: number
  /** 每条检查项各自通过多少用例，便于定位"是哪一项在退步" */
  byCheck: { name: string; passed: number; total: number }[]
  totalTokens: number
  avgDurationMs: number
}

export function summarize(reports: CaseReport[]): EvalSummary {
  const byCheck = CHECK_NAMES.map((name) => {
    const related = reports.flatMap((report) => report.checks.filter((check) => check.name === name))
    return { name, passed: related.filter((check) => check.passed).length, total: related.length }
  })
  const durations = reports.map((report) => report.durationMs)
  return {
    total: reports.length,
    passedCases: reports.filter((report) => report.source === 'model' && report.checks.every((check) => check.passed)).length,
    byCheck,
    totalTokens: reports.reduce((sum, report) => sum + report.promptTokens + report.completionTokens, 0),
    avgDurationMs: durations.length === 0 ? 0 : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
  }
}
