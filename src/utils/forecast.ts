import type { EnvData } from '../types'
import { computeWeatherScore } from './scoring'
import { kmhToBeaufort } from './wind'

/**
 * 出行建议：把未来几天的逐小时预报切成一个个「候选出行窗口」并打分。
 *
 * 打分口径**刻意与历史记录一致** —— 直接复用 `scoring.ts` 的 `computeWeatherScore`，
 * 这样「预报说 85 分」和「昨天骑完是 85 分」用的是同一把尺子，两个面板的分数可以横向比较。
 *
 * 聚合方式按评分模型的语义来定：
 *   · 温度 / 湿度 / 空气质量 → 取窗口内**均值**
 *   · 降水量 → 取窗口内**总和**（模型里它代表「这次出行的总降水」）
 *   · 风力 → 取窗口内**最大值**（与 useWeather 采集历史数据时的口径一致，宁可高估风险）
 *
 * 只算天气适宜度、不含路线质量：路线是既定事实，跟几点出门没关系。
 */

/** 一个候选出行窗口的时长（小时） */
export const WINDOW_HOURS = 2
/** 只在白天找窗口 —— 太早或太晚出门不现实 */
export const DAY_START_HOUR = 5
export const DAY_END_HOUR = 21

/** 逐小时气象点（时间为当地时刻，形如 `2026-09-29T07:00`） */
export interface HourlyPoint {
  time: string
  temperature: number | null
  humidity: number | null
  precipitation: number | null
  precipitationProbability: number | null
  windKmh: number | null
  /** 空气质量；预报源不可用时为 null */
  aqi: number | null
}

export interface TripWindow {
  /** `YYYY-MM-DD` */
  date: string
  /** 起始整点（含） */
  startHour: number
  /** 结束整点（不含） */
  endHour: number
  /** 天气适宜度 0–100 */
  score: number
  temperature: number | null
  /** 窗口内累计降水，mm */
  precipitation: number
  /** 窗口内最高降雨概率，% */
  maxProbability: number
  windLevel: number | null
  /** 一句话说明，用作界面副标题 */
  reason: string
}

const mean = (nums: number[]): number | null =>
  nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null

const round1 = (v: number): number => Math.round(v * 10) / 10

/** 从 `2026-09-29T07:00` 里取出小时数 */
function hourOf(time: string): number | null {
  const matched = /T(\d{2}):/.exec(time)
  return matched ? Number(matched[1]) : null
}

/** 一句话说明：先说「为什么不合适」，再说「为什么推荐」 */
export function windowReason(w: Omit<TripWindow, 'reason'>): string {
  if (w.precipitation >= 2) return '预计有雨'
  if (w.maxProbability >= 60) return '降雨概率高'
  if (w.temperature != null && w.temperature >= 30) return '气温偏高'
  if (w.temperature != null && w.temperature <= 5) return '气温偏低'
  if (w.windLevel != null && w.windLevel >= 5) return '风较大'
  if (w.score >= 85) return '条件极佳'
  if (w.score >= 70) return '条件不错'
  if (w.score >= 50) return '条件一般'
  return '条件较差'
}

/**
 * 把从 `startHour` 开始的连续 `WINDOW_HOURS` 小时聚合成一个窗口。
 *
 * 缺任何一小时都返回 null —— 与其用半截数据算出个好看的分数，不如这一天不给建议。
 */
export function scoreWindow(date: string, points: HourlyPoint[], startHour: number): TripWindow | null {
  const wanted = new Set<number>()
  for (let i = 0; i < WINDOW_HOURS; i++) wanted.add(startHour + i)

  const picked = points.filter((p) => {
    if (!p.time.startsWith(date)) return false
    const hour = hourOf(p.time)
    return hour != null && wanted.has(hour)
  })
  if (picked.length < WINDOW_HOURS) return null

  const numbers = (pick: (p: HourlyPoint) => number | null): number[] =>
    picked.map(pick).filter((v): v is number => v != null)

  const temperatures = numbers((p) => p.temperature)
  const humidities = numbers((p) => p.humidity)
  const probabilities = numbers((p) => p.precipitationProbability)
  const winds = numbers((p) => p.windKmh)
  const aqis = numbers((p) => p.aqi)

  const env: EnvData = {
    temperature: temperatures.length ? round1(mean(temperatures)!) : null,
    humidity: mean(humidities),
    precipitation: round1(picked.reduce((sum, p) => sum + Math.max(0, p.precipitation ?? 0), 0)),
    precipitationProbability: mean(probabilities),
    aqi: mean(aqis),
    pm25: null,
    windLevel: winds.length ? kmhToBeaufort(Math.max(...winds)) : null,
  }

  const base: Omit<TripWindow, 'reason'> = {
    date,
    startHour,
    endHour: startHour + WINDOW_HOURS,
    score: computeWeatherScore(env).score,
    temperature: env.temperature,
    precipitation: env.precipitation ?? 0,
    maxProbability: probabilities.length ? Math.round(Math.max(...probabilities)) : 0,
    windLevel: env.windLevel,
  }
  return { ...base, reason: windowReason(base) }
}

/** 某一天的全部候选窗口，按分数从高到低 */
export function windowsForDay(date: string, points: HourlyPoint[]): TripWindow[] {
  const windows: TripWindow[] = []
  for (let hour = DAY_START_HOUR; hour + WINDOW_HOURS <= DAY_END_HOUR; hour++) {
    const window = scoreWindow(date, points, hour)
    if (window) windows.push(window)
  }
  return windows.sort((a, b) => b.score - a.score)
}

/** 未来每天的「最佳窗口」，按日期升序；某天数据不足则为 null */
export function bestWindowPerDay(points: HourlyPoint[]): (TripWindow | null)[] {
  const dates = [...new Set(points.map((p) => p.time.slice(0, 10)))].sort()
  return dates.map((date) => windowsForDay(date, points)[0] ?? null)
}

/** 从多天里挑出最值得出门的那一个窗口；同分取更早的那天 */
export function bestOverall(days: (TripWindow | null)[]): TripWindow | null {
  let best: TripWindow | null = null
  for (const window of days) {
    if (!window) continue
    if (!best || window.score > best.score) best = window
  }
  return best
}

/** `09:00–11:00` 这样的时段文案 */
export function windowLabel(window: Pick<TripWindow, 'startHour' | 'endHour'>): string {
  const pad = (h: number) => `${String(h).padStart(2, '0')}:00`
  return `${pad(window.startHour)}–${pad(window.endHour)}`
}
