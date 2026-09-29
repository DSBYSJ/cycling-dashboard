import { describe, expect, it } from 'vitest'
import { describeRideOption } from '../rideOption'
import type { RideRecord } from '../../types'

/**
 * 测试只关心「下拉里显示什么文字」，RideRecord 的其余字段与这里无关，
 * 所以用最小对象 + 类型断言，避免为无关字段凑一整套假数据。
 */
function makeRide(overrides: Record<string, unknown> = {}): RideRecord {
  return { id: 'r1', date: '2026-09-28', distanceKm: null, scores: null, ...overrides } as unknown as RideRecord
}

describe('describeRideOption', () => {
  it('字段齐全时按「编号 · 日期 · 距离 · 分数」拼接', () => {
    const ride = makeRide({ label: '3', distanceKm: 32.5, scores: { total: 68 } })
    expect(describeRideOption(ride)).toBe('#3 · 2026-09-28 · 32.5 km · 68 分')
  })

  it('没有编号时省略编号，不出现空 #', () => {
    const ride = makeRide({ distanceKm: 20, scores: { total: 75 } })
    expect(describeRideOption(ride)).toBe('2026-09-28 · 20 km · 75 分')
  })

  it('距离或分数缺失时，对应项不显示', () => {
    expect(describeRideOption(makeRide({ label: '1' }))).toBe('#1 · 2026-09-28')
    expect(describeRideOption(makeRide({ distanceKm: 15 }))).toBe('2026-09-28 · 15 km')
  })

  it('只剩日期时也照常返回（不报错、不含占位符）', () => {
    expect(describeRideOption(makeRide())).toBe('2026-09-28')
  })
})
