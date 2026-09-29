import type { RideRecord } from '../types'

/**
 * 下拉选择器里展示的「记录摘要」文本，形如：
 *   #3 · 2026-09-28 · 32.5 km · 68 分
 *
 * 缺哪项就省略哪项（不写「未知」「--」这类占位）——
 * 下拉的宽度有限，占位符只会挤掉真正有用的信息，反而更难一眼扫出要选的那条。
 */
export function describeRideOption(ride: RideRecord): string {
  const parts: string[] = []
  if (ride.label) parts.push(`#${ride.label}`)
  parts.push(ride.date)
  if (ride.distanceKm != null) parts.push(`${ride.distanceKm} km`)
  const total = ride.scores?.total
  if (total != null) parts.push(`${total} 分`)
  return parts.join(' · ')
}
