import type { RideRecord } from '../../../src/types.ts'
import { SURFACE_LABELS, TRAFFIC_LABELS } from '../../../src/types.ts'

/**
 * AI 骑行教练 —— 送进模型之前的数据压缩（上下文工程）。
 *
 * 一条带 2 万个轨迹点的记录，原始体积约 1~2MB。直接塞进 prompt 有两个问题：
 *   1. 远超模型上下文窗口，接口直接报错
 *   2. 即使塞得下，token 成本也会高到不可接受（每次复盘都要重传一遍轨迹）
 *
 * 但复盘并不需要每个坐标点 —— 它需要的是「人做复盘时会看的那些指标」。
 * 所以这里把记录压成一份 facts（实测约 0.6KB，降低三个数量级），
 * 而模型做判断所需的信息一条不少。
 *
 * 本文件是**纯函数**，不触网、不读库，因此可以被单元测试完整覆盖。
 */

/** 历史对比最多带几次，避免老数据把 prompt 撑大 */
const HISTORY_LIMIT = 5

/** 同一次骑行在历史里的对比点 */
export interface HistoryPoint {
  date: string
  distanceKm: number | null
  avgSpeed: number | null
  totalScore: number | null
}

/**
 * 历史对比只需要这几个字段。
 * 刻意不要求完整 RideRecord —— 列表接口返回的项本来就不含轨迹（那是体积最大的字段），
 * 而且写清楚"只用到这五个"能避免调用方为了凑类型去多查一次详情。
 */
export type HistorySource = Pick<RideRecord, 'id' | 'date' | 'distanceKm' | 'avgSpeed' | 'scores'>

export interface RideFacts {
  date: string
  routeName: string | null
  distanceKm: number | null
  durationMin: number | null
  avgSpeed: number | null
  maxSpeed: number | null
  elevationGain: number | null
  avgGrade: number | null
  surface: string | null
  traffic: string | null
  temperature: number | null
  humidity: number | null
  windLevel: number | null
  precipitation: number | null
  aqi: number | null
  scores: { total: number; weather: number; route: number } | null
  /** 规则引擎给出的评价与建议。既是模型的参考基线，也是降级时的兜底内容 */
  ruleComment: string
  ruleSuggestions: string[]
  history: HistoryPoint[]
}

/** 收敛到 1 位小数并剔除 NaN/Infinity —— 模型不需要 IEEE754 的浮点尾巴，那是纯粹的 token 浪费 */
function round1(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value * 10) / 10
}

function roundInt(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value)
}

export function buildRideFacts(ride: RideRecord, history: HistorySource[] = []): RideFacts {
  const env = ride.env
  const route = ride.route
  const scores = ride.scores

  return {
    date: ride.date,
    routeName: ride.label ?? ride.routeName ?? null,
    distanceKm: round1(ride.distanceKm),
    durationMin: roundInt(ride.durationMin),
    avgSpeed: round1(ride.avgSpeed),
    maxSpeed: round1(ride.maxSpeed),
    elevationGain: roundInt(route?.elevationGain),
    avgGrade: round1(route?.avgGrade),
    surface: route?.surface ? (SURFACE_LABELS[route.surface] ?? null) : null,
    traffic: route?.traffic ? (TRAFFIC_LABELS[route.traffic] ?? null) : null,
    temperature: round1(env?.temperature),
    humidity: roundInt(env?.humidity),
    windLevel: env?.windLevel == null ? null : roundInt(env.windLevel),
    precipitation: round1(env?.precipitation),
    aqi: roundInt(env?.aqi),
    scores: scores ? { total: scores.total, weather: scores.weather, route: scores.route } : null,
    ruleComment: typeof ride.comment === 'string' ? ride.comment : '',
    ruleSuggestions: Array.isArray(ride.suggestions) ? ride.suggestions : [],
    history: history.slice(0, HISTORY_LIMIT).map((item) => ({
      date: item.date,
      distanceKm: round1(item.distanceKm),
      avgSpeed: round1(item.avgSpeed),
      totalScore: item.scores?.total ?? null,
    })),
  }
}

/** 一行「标签: 值 单位」；值为空时整行省略 —— 缺项写「未知」只会浪费 token 并诱导模型编造 */
function row(label: string, value: string | number | null, unit = ''): string | null {
  if (value === null || value === '') return null
  return `${label}: ${value}${unit}`
}

function keep(rows: (string | null)[]): string[] {
  return rows.filter((line): line is string => line !== null)
}

/** 把 facts 渲染成紧凑的键值文本。比 JSON 更省 token（不用写键名引号与括号） */
export function renderFacts(facts: RideFacts): string {
  const env = keep([
    row('气温', facts.temperature, ' ℃'),
    row('湿度', facts.humidity, ' %'),
    row('风力', facts.windLevel, ' 级'),
    row('降水量', facts.precipitation, ' mm'),
    row('空气质量 AQI', facts.aqi),
  ])
  const route = keep([
    row('累计爬升', facts.elevationGain, ' m'),
    row('平均坡度', facts.avgGrade, ' %'),
    row('路面', facts.surface),
    row('交通流量', facts.traffic),
  ])
  const perf = keep([
    row('距离', facts.distanceKm, ' km'),
    row('时长', facts.durationMin, ' 分钟'),
    row('平均速度', facts.avgSpeed, ' km/h'),
    row('最高速度', facts.maxSpeed, ' km/h'),
  ])

  const sections = [
    ['【本次骑行】', keep([row('日期', facts.date), row('路线', facts.routeName)]).concat(perf)],
    ['【环境】', env],
    ['【路线】', route],
  ] as const

  const blocks: string[] = []
  for (const [title, lines] of sections) {
    blocks.push(lines.length === 0 ? `${title}\n(无数据)` : `${title}\n${lines.join('\n')}`)
  }

  if (facts.scores) {
    blocks.push(
      `【系统评分】\n综合 ${facts.scores.total} 分（天气适宜度 ${facts.scores.weather} / 路线质量 ${facts.scores.route}）\n` +
        `评分口径：综合分 = 天气×0.6 + 路线×0.4；天气看气温/空气质量/风力/湿度/降雨，路线看爬升/坡度/路面/车流。`
    )
  }

  if (facts.history.length > 0) {
    const lines = facts.history.map((item) =>
      keep([row(item.date, item.distanceKm, 'km'), row('', item.avgSpeed, 'km/h'), row('评分', item.totalScore)]).join(' ')
    )
    blocks.push(`【历史对比（由近到远，不含本次）】\n${lines.join('\n')}`)
  }

  if (facts.ruleComment || facts.ruleSuggestions.length > 0) {
    const base = [facts.ruleComment, ...facts.ruleSuggestions.map((s) => `· ${s}`)].filter(Boolean).join('\n')
    blocks.push(`【规则引擎已给出的评价（供参考，可沿用或推翻，但不要与之矛盾却不说明理由）】\n${base}`)
  }

  return blocks.join('\n\n')
}

export const COACH_SYSTEM_PROMPT = [
  '你是一名公路自行车教练，根据一次骑行的结构化数据写复盘。',
  '',
  '硬性要求：',
  '1. 只使用给定的数据。数据里没有的信息（心率、功率、装备、路况细节、天气之外的感受）一律不要编造。',
  '2. 建议必须具体、可执行。禁止“注意安全”“多加练习”“保持良好心态”这类空话 ——',
  '   要写清“下次做什么、做多少”。',
  '3. 数据正常就直说正常，不要为了显得有观点而硬找问题。',
  '4. 语气像教练说话：直接、专业、不恭维。',
  '5. 全部用中文，不要中英混杂 —— 该写“踏频”就别写 cadence。单位与通用缩写（km/h、rpm、AQI）可以保留。',
  '',
  '输出格式：',
  '只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字。结构如下：',
  '{',
  '  "summary": "一句话总评，40 字以内",',
  '  "highlights": ["做得好的地方，1-3 条，每条 40 字以内"],',
  '  "improvements": [{"point": "问题点，20 字以内", "how": "具体怎么改，60 字以内"}],',
  '  "nextGoal": "下一次骑行的可量化目标，40 字以内",',
  '  "risk": "需要警惕的风险；确实没有就填 null"',
  '}',
  'improvements 给 1-3 条，按重要性排序。',
].join('\n')

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function buildMessages(facts: RideFacts): ChatMessage[] {
  return [
    { role: 'system', content: COACH_SYSTEM_PROMPT },
    { role: 'user', content: `请复盘这次骑行：\n\n${renderFacts(facts)}\n\n请只返回 JSON。` },
  ]
}

/** 模型第一次返回的格式不合法时，追加一句纠正后重试 */
export function buildRetryMessages(messages: ChatMessage[], reason: string): ChatMessage[] {
  return [
    ...messages,
    { role: 'assistant', content: '(上一次返回的内容不是合法 JSON)' },
    {
      role: 'user',
      content: `上一次的输出无法解析：${reason}\n请重新输出，且只输出一个 JSON 对象，不要代码块标记、不要多余文字。`,
    },
  ]
}
