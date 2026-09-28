import { describe, expect, it } from 'vitest'
import {
  bestOverall,
  bestWindowPerDay,
  scoreWindow,
  windowLabel,
  windowReason,
  windowsForDay,
  type HourlyPoint,
} from '../forecast'
import { kmhToBeaufort } from '../wind'
import { dayLabel } from '../../hooks/useForecast'

/** 一个「理想条件」的整点：20℃、湿度 50%、无雨、微风、空气优 */
const point = (time: string, patch: Partial<HourlyPoint> = {}): HourlyPoint => ({
  time,
  temperature: 20,
  humidity: 50,
  precipitation: 0,
  precipitationProbability: 0,
  windKmh: 5,
  aqi: 30,
  ...patch,
})

/** 生成某天 0–23 点的完整序列，可按小时定制 */
function dayPoints(date: string, patch: (hour: number) => Partial<HourlyPoint> = () => ({})): HourlyPoint[] {
  return Array.from({ length: 24 }, (_, hour) =>
    point(`${date}T${String(hour).padStart(2, '0')}:00`, patch(hour))
  )
}

describe('出行窗口打分', () => {
  it('聚合口径：温度取均值、降水求和、风力取窗口内最大值', () => {
    const points = [
      point('2026-09-29T09:00', { temperature: 20, precipitation: 0.5, windKmh: 5 }),
      point('2026-09-29T10:00', { temperature: 24, precipitation: 1.5, windKmh: 35 }),
    ]
    const window = scoreWindow('2026-09-29', points, 9)
    expect(window).not.toBeNull()
    expect(window!.temperature).toBe(22) // (20 + 24) / 2
    expect(window!.precipitation).toBe(2) // 0.5 + 1.5，评分模型里它代表「本次出行的总降水」
    expect(window!.windLevel).toBe(kmhToBeaufort(35)) // 取最大风速，宁可高估风险
    expect(windowLabel(window!)).toBe('09:00–11:00')
  })

  it('缺一个小时就不给窗口 —— 宁可不建议，也不用半截数据凑个分数', () => {
    const onlyNine = [point('2026-09-29T09:00')]
    expect(scoreWindow('2026-09-29', onlyNine, 9)).toBeNull()
  })

  it('日期不匹配的点不会被算进来', () => {
    const points = [point('2026-09-28T09:00'), point('2026-09-28T10:00')]
    expect(scoreWindow('2026-09-29', points, 9)).toBeNull()
  })

  it('理想条件拿满分，下雨时段显著扣分 —— 与历史记录是同一把尺子', () => {
    const sunny = dayPoints('2026-09-29')
    const rainy = dayPoints('2026-09-30', () => ({ precipitation: 5, precipitationProbability: 80 }))
    expect(scoreWindow('2026-09-29', sunny, 9)!.score).toBe(100)
    // rainFactor = 5×0.6 + 80×0.4 = 35 → 扣 70 分
    expect(scoreWindow('2026-09-30', rainy, 9)!.score).toBe(30)
  })

  it('空气质量缺失只是少算一项，不会算成 0 分', () => {
    const points = [
      point('2026-09-29T09:00', { aqi: null }),
      point('2026-09-29T10:00', { aqi: null }),
    ]
    expect(scoreWindow('2026-09-29', points, 9)!.score).toBe(100)
  })
})

describe('按天挑选最佳窗口', () => {
  it('每天只给一个窗口，且按日期升序', () => {
    const points = [...dayPoints('2026-09-29'), ...dayPoints('2026-09-30')]
    const best = bestWindowPerDay(points)
    expect(best).toHaveLength(2)
    expect(best[0]!.date).toBe('2026-09-29')
    expect(best[1]!.date).toBe('2026-09-30')
  })

  it('避开当天有雨的那一段', () => {
    // 14 点起下雨 → 最佳窗口不应跨过 14 点
    const points = dayPoints('2026-09-29', (hour) =>
      hour >= 14 ? { precipitation: 4, precipitationProbability: 90 } : {}
    )
    const best = windowsForDay('2026-09-29', points)[0]
    expect(best.score).toBe(100)
    expect(best.endHour).toBeLessThanOrEqual(14)
  })

  it('数据不足的那天为 null，排序不受影响', () => {
    const points = [...dayPoints('2026-09-29'), point('2026-09-30T09:00')] // 30 号只有一个点
    const best = bestWindowPerDay(points)
    expect(best).toHaveLength(2)
    expect(best[0]).not.toBeNull()
    expect(best[1]).toBeNull()
  })

  it('bestOverall 挑出整段时间里最值得出门的那天', () => {
    const points = [
      ...dayPoints('2026-09-29', () => ({ precipitation: 3, precipitationProbability: 70 })),
      ...dayPoints('2026-09-30'),
    ]
    expect(bestOverall(bestWindowPerDay(points))!.date).toBe('2026-09-30')
  })

  it('全是 null 时 bestOverall 返回 null，不会崩', () => {
    expect(bestOverall([null, null])).toBeNull()
    expect(bestWindowPerDay([])).toEqual([])
  })
})

describe('窗口说明文案', () => {
  const base = {
    date: '2026-09-29',
    startHour: 9,
    endHour: 11,
    score: 100,
    temperature: 20,
    precipitation: 0,
    maxProbability: 0,
    windLevel: 2,
  }

  it('先说风险，再谈推荐', () => {
    expect(windowReason({ ...base, precipitation: 5 })).toBe('预计有雨')
    expect(windowReason({ ...base, maxProbability: 80 })).toBe('降雨概率高')
    expect(windowReason({ ...base, temperature: 33 })).toBe('气温偏高')
    expect(windowReason({ ...base, temperature: 2 })).toBe('气温偏低')
    expect(windowReason({ ...base, windLevel: 6 })).toBe('风较大')
  })

  it('没有风险时按分数分档', () => {
    expect(windowReason({ ...base, score: 92 })).toBe('条件极佳')
    expect(windowReason({ ...base, score: 75 })).toBe('条件不错')
    expect(windowReason({ ...base, score: 60 })).toBe('条件一般')
    expect(windowReason({ ...base, score: 30 })).toBe('条件较差')
  })
})

describe('日期标签', () => {
  it('前两天固定是「今天 / 明天」', () => {
    expect(dayLabel('2026-09-29', 0)).toBe('今天')
    expect(dayLabel('2026-09-30', 1)).toBe('明天')
  })

  it('第三天起显示周几', () => {
    expect(dayLabel('2026-10-01', 2)).toBe('周四')
  })
})
