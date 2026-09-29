import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../../types'
import { describeSimplification, simplifyTrack } from '../trackSimplify'

/**
 * 抽稀算法测试。
 *
 * 重点不是"点数变少了"，而是**变少之后形状还在**：
 * 起点终点不能丢、拐角不能抹平、海拔与时间戳不能被弄丢。
 * 这几条任何一条不成立，用户看到的轨迹就是错的 —— 而他还不知道。
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

describe('轨迹抽稀', () => {
  it('点数没超上限时原样返回，且是同一个引用（绝大多数记录走这条，零开销）', () => {
    const points = straightLine(100)
    const result = simplifyTrack(points, 19_500)
    expect(result.changed).toBe(false)
    expect(result.points).toBe(points)
    expect(result.originalCount).toBe(100)
  })

  it('超过上限时精简到上限以内', () => {
    const points = straightLine(30_000)
    const result = simplifyTrack(points, 19_500)
    expect(result.points.length).toBeLessThanOrEqual(19_500)
    expect(result.changed).toBe(true)
    expect(result.originalCount).toBe(30_000)
    expect(result.simplifiedCount).toBe(result.points.length)
  })

  it('起点与终点必须保留 —— 丢了它们在语义上轨迹就断了', () => {
    const points = straightLine(30_000)
    const result = simplifyTrack(points, 19_500)
    const first = result.points[0]
    const last = result.points[result.points.length - 1]
    expect(first.lat).toBeCloseTo(points[0].lat, 10)
    expect(last.lat).toBeCloseTo(points[points.length - 1].lat, 10)
  })

  it('直道可以丢得很狠：一条直线上的中间点几乎全被去掉', () => {
    // 直线没有形状信息，Douglas-Peucker 应当只留首尾
    const points = straightLine(10_000, 5)
    const result = simplifyTrack(points, 1_000)
    expect(result.points.length).toBeLessThanOrEqual(10)
    expect(result.points.length).toBeGreaterThanOrEqual(2)
  })

  it('★ 拐角必须留下 —— 这是 Douglas-Peucker 相比"每 N 个取 1 个"的关键优势', () => {
    // 构造一个 L 形：先向东 5000 点，再向北 5000 点，拐点在正中间
    const east = Array.from({ length: 5_000 }, (_, i) => ({ lat: 23, lon: 113 + i * 0.00009 }))
    const north = Array.from({ length: 5_000 }, (_, i) => ({ lat: 23 + i * 0.00009, lon: 113 + 5_000 * 0.00009 }))
    const points = [...east, ...north]
    const corner = points[5_000]

    const result = simplifyTrack(points, 19_500)
    expect(result.points.length).toBeLessThanOrEqual(19_500)

    // 拐点（或离它极近的点）必须还在结果里
    const stillThere = result.points.some(
      (p) => Math.abs(p.lat - corner.lat) < 1e-6 && Math.abs(p.lon - corner.lon) < 1e-6
    )
    expect(stillThere).toBe(true)
  })

  it('保留海拔与时间戳 —— 抽稀只挑点，不改点里的内容', () => {
    const points = straightLine(30_000)
    const result = simplifyTrack(points, 19_500)
    for (const point of result.points) {
      expect(typeof point.ele).toBe('number')
      expect(typeof point.time).toBe('string')
    }
    // 每个保留下来的点都必须是原始点（而不是被重建出来的近似点）
    const original = new Set(points.map((p) => `${p.lat}|${p.lon}`))
    for (const point of result.points) {
      expect(original.has(`${point.lat}|${point.lon}`)).toBe(true)
    }
  })

  it('先丢弃几乎重合的点：等红灯时 GPS 抖动会堆出大量原地重复点', () => {
    // 5000 个点挤在同一个位置（重合约 0.5 米），再来一段正常移动
    const stuck = Array.from({ length: 5_000 }, () => ({ lat: 23, lon: 113 }))
    const moving = straightLine(100, 20)
    const result = simplifyTrack([...stuck, ...moving], 200)
    expect(result.points.length).toBeLessThanOrEqual(200)
    // 原地那 5000 个点只该剩一个
    expect(result.points.filter((p) => p.lat === 23 && p.lon === 113).length).toBe(1)
  })

  it('空数组与极少点不会出问题', () => {
    expect(simplifyTrack([], 100).points).toEqual([])
    expect(simplifyTrack([{ lat: 23, lon: 113 }], 100).points.length).toBe(1)
    expect(simplifyTrack([{ lat: 23, lon: 113 }, { lat: 23.001, lon: 113 }], 100).points.length).toBe(2)
  })

  it('提示文案只在真的精简过才给', () => {
    expect(describeSimplification(simplifyTrack(straightLine(10), 100))).toBe('')
    const big = simplifyTrack(straightLine(30_000), 19_500)
    const text = describeSimplification(big)
    expect(text).toContain('30000')
    expect(text).toContain(String(big.simplifiedCount))
  })
})
