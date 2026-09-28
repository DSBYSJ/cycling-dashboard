/**
 * 风速换算。
 *
 * 单独成文件是为了让 `utils/forecast.ts`（出行建议）也能用 ——
 * 否则 utils 就得反向依赖 hooks/useWeather，依赖方向会乱。
 */

/** km/h 风速 → 蒲福风力等级（0–12） */
export function kmhToBeaufort(kmh: number): number {
  const thresholds = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 117]
  let level = 0
  while (level < thresholds.length && kmh >= thresholds[level]) level++
  return level
}
