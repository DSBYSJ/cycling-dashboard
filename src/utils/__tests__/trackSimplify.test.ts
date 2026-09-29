import { describe, expect, it } from 'vitest'
import type { RideRecord, TrackPoint } from '../../types'
import {
  describeSimplification,
  simplifyRide,
  simplifySpeedSeries,
  simplifyTrack,
  type SpeedSample,
} from '../trackSimplify'

/**
 * 抽稀算法测试。
 *
 * 重点不是"点数变少了"，而是**变少之后信息还在**：
 * 起点终点不能丢、拐角与速度尖峰不能抹平、海拔与时间戳不能被弄丢。
 * 这几条任何一条不成立，用户看到的轨迹/曲线就是错的 —— 而他还不知道。
 *
 * ⚠️ 还有一条更隐蔽的：服务端对 **track 与 speedSeries 是两条独立的上限**。
 * 只抽稀其中一个，用户依然存不进去（报错会从「轨迹点过多」变成「速度序列过长」），
 * 所以「simplifyRide 必须同时处理两处」也要有用例守着。
 */

/** 沿纬度方向等间距排一条直线，每步 stepMeters 米 */
function straightLine(count: number, stepMeters = 10): TrackPoint[] {
  const stepDeg = stepMeters / 111_320
  return Array.from({ length: count }, (_, i) => ({
    lat: 23 + i * stepDeg,
    lon: 113,
    ele: 10 + (i % 7),
    time: new Date(Date.UTC(2026, 8, 28, 1, 0, 0) + i * 1000).toISOString(),
  }))
}

/** 一条正弦起伏的速度序列（每 10 米一个采样） */
function sineSpeedSeries(count: number): SpeedSample[] {
  return Array.from({ length: count }, (_, i) => ({
    distanceKm: i * 0.01,
    speed: 20 + Math.sin(i / 500) * 8,
  }))
}

function rideWith(track: TrackPoint[], speedSeries: SpeedSample[]): RideRecord {
  return {
    id: 'r1',
    date: '2026-09-28',
    durationMin: 95,
    distanceKm: 200,
    avgSpeed: 20,
    maxSpeed: 42,
    cityName: '广州',
    cityCode: '101280101',
    location: null,
    env: {
      temperature: 20,
      windLevel: 2,
      humidity: 50,
      precipitation: 0,
      precipitationProbability: 0,
      aqi: 30,
      pm25: 20,
    },
    envMeta: { weatherFetched: true, aqiFetched: true, manualEdited: false },
    route: { elevationGain: 500, avgGrade: 1, surface: 'asphalt', traffic: 'low' },
    track,
    speedSeries,
    scores: null,
    comment: '',
    suggestions: [],
    notes: '',
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('轨迹抽稀', () => {
  it('点数没超上限时原样返回，且是同一个引用（绝大多数记录走这条，零开销）', () => {
    const points = straightLine(100)
    const result = simplifyTrack(points, 19_500)
    expect(result.changed).toBe(false)
    expect(result.items).toBe(points)
    expect(result.originalCount).toBe(100)
  })

  it('超过上限时精简到上限以内', () => {
    const points = straightLine(30_000)
    const result = simplifyTrack(points, 19_500)
    expect(result.items.length).toBeLessThanOrEqual(19_500)
    expect(result.changed).toBe(true)
    expect(result.originalCount).toBe(30_000)
    expect(result.simplifiedCount).toBe(result.items.length)
  })

  it('起点与终点必须保留 —— 丢了它们在语义上轨迹就断了', () => {
    const points = straightLine(30_000)
    const result = simplifyTrack(points, 19_500)
    const first = result.items[0]
    const last = result.items[result.items.length - 1]
    expect(first.lat).toBeCloseTo(points[0].lat, 10)
    expect(last.lat).toBeCloseTo(points[points.length - 1].lat, 10)
  })

  it('直道可以丢得很狠：一条直线上的中间点几乎全被去掉', () => {
    const result = simplifyTrack(straightLine(10_000, 5), 1_000)
    expect(result.items.length).toBeLessThanOrEqual(10)
    expect(result.items.length).toBeGreaterThanOrEqual(2)
  })

  it('★ 拐角必须留下 —— 这是 Douglas-Peucker 相比"每 N 个取 1 个"的关键优势', () => {
    const east = Array.from({ length: 5_000 }, (_, i) => ({ lat: 23, lon: 113 + i * 0.00009 }))
    const north = Array.from({ length: 5_000 }, (_, i) => ({ lat: 23 + i * 0.00009, lon: 113 + 5_000 * 0.00009 }))
    const points = [...east, ...north]
    const corner = points[5_000]

    const result = simplifyTrack(points, 19_500)
    expect(result.items.length).toBeLessThanOrEqual(19_500)

    const stillThere = result.items.some(
      (p) => Math.abs(p.lat - corner.lat) < 1e-6 && Math.abs(p.lon - corner.lon) < 1e-6
    )
    expect(stillThere).toBe(true)
  })

  it('保留海拔与时间戳 —— 抽稀只挑点，不改点里的内容', () => {
    const points = straightLine(30_000)
    const result = simplifyTrack(points, 19_500)
    for (const point of result.items) {
      expect(typeof point.ele).toBe('number')
      expect(typeof point.time).toBe('string')
    }
    // 每个保留下来的点都必须是原始点（而不是被重建出来的近似点）
    const original = new Set(points.map((p) => `${p.lat}|${p.lon}`))
    for (const point of result.items) {
      expect(original.has(`${point.lat}|${point.lon}`)).toBe(true)
    }
  })

  it('先丢弃几乎重合的点：等红灯时 GPS 抖动会堆出大量原地重复点', () => {
    const stuck = Array.from({ length: 5_000 }, () => ({ lat: 23, lon: 113 }))
    const moving = straightLine(100, 20)
    const result = simplifyTrack([...stuck, ...moving], 200)
    expect(result.items.length).toBeLessThanOrEqual(200)
    expect(result.items.filter((p) => p.lat === 23 && p.lon === 113).length).toBe(1)
  })

  it('空数组与极少点不会出问题', () => {
    expect(simplifyTrack([], 100).items).toEqual([])
    expect(simplifyTrack([{ lat: 23, lon: 113 }], 100).items.length).toBe(1)
    expect(simplifyTrack([{ lat: 23, lon: 113 }, { lat: 23.001, lon: 113 }], 100).items.length).toBe(2)
  })
})

describe('速度序列抽稀', () => {
  it('没超上限时同样是同一个引用，零开销', () => {
    const series = sineSpeedSeries(1000)
    const result = simplifySpeedSeries(series, 19_500)
    expect(result.changed).toBe(false)
    expect(result.items).toBe(series)
  })

  it('超过上限时精简到上限以内，且首尾采样保留', () => {
    const series = sineSpeedSeries(30_000)
    const result = simplifySpeedSeries(series, 19_500)
    expect(result.items.length).toBeLessThanOrEqual(19_500)
    expect(result.items.length).toBeGreaterThan(2)
    expect(result.items[0].distanceKm).toBe(series[0].distanceKm)
    expect(result.items[result.items.length - 1].distanceKm).toBe(series[series.length - 1].distanceKm)
  })

  it('★ 速度尖峰必须留下 —— 归一化就是为了不让"距离"把"速度"淹没', () => {
    // 一条全程 20 km/h 的平坦曲线，中间插一个 55 km/h 的尖峰（下坡冲刺）
    const series: SpeedSample[] = Array.from({ length: 30_000 }, (_, i) => ({
      distanceKm: i * 0.01,
      speed: 20,
    }))
    series[15_000] = { distanceKm: 150, speed: 55 }

    const result = simplifySpeedSeries(series, 1_000)
    expect(result.items.some((s) => s.speed === 55)).toBe(true)
  })

  it('抽稀后距离仍严格递增（曲线不能出现回折）', () => {
    const result = simplifySpeedSeries(sineSpeedSeries(30_000), 19_500)
    for (let i = 1; i < result.items.length; i += 1) {
      expect(result.items[i].distanceKm).toBeGreaterThan(result.items[i - 1].distanceKm)
    }
  })
})

describe('simplifyRide：两处上限必须一起处理', () => {
  it('★ 轨迹与速度序列都超限时，两处都要落到上限内', () => {
    // 这条用例是这次事故的直接产物：只抽稀轨迹的话，speedSeries 会留在 3 万点，
    // 服务端报错从「轨迹点过多」变成「速度序列过长」，用户依然存不进去
    const ride = rideWith(straightLine(30_000), sineSpeedSeries(30_000))
    const result = simplifyRide(ride)

    expect(result.changed).toBe(true)
    expect(result.ride.track.length).toBeLessThanOrEqual(19_500)
    expect(result.ride.speedSeries.length).toBeLessThanOrEqual(19_500)
    expect(result.track.changed).toBe(true)
    expect(result.series.changed).toBe(true)
    expect(result.ride.id).toBe(ride.id)
  })

  it('只有速度序列超限时也要处理（轨迹本来就正常）', () => {
    const ride = rideWith(straightLine(500), sineSpeedSeries(30_000))
    const result = simplifyRide(ride)
    expect(result.track.changed).toBe(false)
    expect(result.series.changed).toBe(true)
    expect(result.ride.speedSeries.length).toBeLessThanOrEqual(19_500)
    expect(result.ride.track).toBe(ride.track)
  })

  it('两处都没超限时原样返回同一个对象', () => {
    const ride = rideWith(straightLine(500), sineSpeedSeries(500))
    const result = simplifyRide(ride)
    expect(result.changed).toBe(false)
    expect(result.ride).toBe(ride)
  })

  it('字段缺失（旧记录没有 speedSeries）不会崩', () => {
    const ride = { ...rideWith(straightLine(10), []), speedSeries: undefined } as unknown as RideRecord
    const result = simplifyRide(ride)
    expect(result.changed).toBe(false)
    expect(result.series.simplifiedCount).toBe(0)
  })

  it('提示文案要把两处都讲清楚，且只在真的精简过才给', () => {
    expect(describeSimplification(simplifyRide(rideWith(straightLine(10), sineSpeedSeries(10))))).toBe('')

    const both = simplifyRide(rideWith(straightLine(30_000), sineSpeedSeries(30_000)))
    const text = describeSimplification(both)
    expect(text).toContain('轨迹点 30000')
    expect(text).toContain('速度采样 30000')

    const onlySeries = simplifyRide(rideWith(straightLine(500), sineSpeedSeries(30_000)))
    expect(describeSimplification(onlySeries)).toContain('速度采样')
    expect(describeSimplification(onlySeries)).not.toContain('轨迹点')
  })
})
