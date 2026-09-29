import type { RideRecord, TrackPoint } from '../types'

/**
 * 轨迹与速度序列的抽稀。
 *
 * 为什么需要它：长距离骑行或手机直录很容易产生三四万个采样点，而后端有上限。
 * 但直接提高上限只是把问题往后推 —— **两万个点对显示毫无意义**：
 * 屏幕就一千多像素宽，地图缩放后相邻的点根本落进同一个像素。
 * 反倒是点数越多，上传越慢、渲染越卡、数据库越大、备份越臃肿。
 *
 * ⚠️⚠️ **服务端对 `track` 与 `speedSeries` 是两条独立的上限**（各 2 万点）。
 * 第一次修复只顾了轨迹，结果用户还是存不进去 —— 报错从「轨迹点过多」
 * 变成了「速度序列过长」。所以这里提供一个 `simplifyRide()`，
 * **一次把两处都处理好**，调用方不要只挑一个。
 *
 * 算法：**Douglas-Peucker**（垂距限制法），GPX 简化的业界标准。
 * 相比"每 N 个取 1 个"的等间隔抽样，它保留了形状的关键信息 ——
 * 直道上可以丢得很狠，弯道、拐角、速度尖峰处的点会留下来。
 *
 * 本文件是纯函数，不依赖任何运行时环境，可被完整单测覆盖。
 */

/** 速度序列的一个采样点（对应 RideRecord.speedSeries） */
export interface SpeedSample {
  distanceKm: number
  speed: number
}

export interface SimplifyResult<T> {
  items: T[]
  originalCount: number
  simplifiedCount: number
  /** 是否发生了精简。为 false 时 items 就是原数组（同一个引用） */
  changed: boolean
}

/** 两点之间小于这个距离（米）视为重合 —— 等红灯时的 GPS 抖动就属于这种 */
const DUPLICATE_METERS = 3
/** 轨迹容差从 1 米起步 */
const TRACK_TOLERANCE_START_METERS = 1
/** 轨迹容差上限（米）。到这个量级已经非常粗了，再加就没意义 */
const TRACK_TOLERANCE_MAX_METERS = 2000
/** 速度序列的容差作用在归一化坐标（0~1）上，所以量级完全不同 */
const SERIES_TOLERANCE_START = 0.0005
const SERIES_TOLERANCE_MAX = 0.2
/** 容差放大倍率。指数增长让它通常三五轮就收敛，不必跑几十次 DP */
const TOLERANCE_GROWTH = 1.6
/** 经纬度 → 米 的换算基准（1 度纬度约 111.32 km） */
const METERS_PER_DEGREE = 111_320

interface PlanePoint {
  x: number
  y: number
}

/**
 * 投影到局部平面。
 * 用等距圆柱投影（经度按 cos(纬度) 缩放）—— 在单次骑行的范围里
 * 这个近似的误差远小于 Douglas-Peucker 的容差，没必要上真正的墨卡托。
 */
function project(points: TrackPoint[]): PlanePoint[] {
  if (points.length === 0) return []
  let sumLat = 0
  for (const p of points) sumLat += p.lat
  const refLat = sumLat / points.length
  const scale = Math.cos((refLat * Math.PI) / 180)
  return points.map((p) => ({ x: p.lon * scale, y: p.lat }))
}

/**
 * 速度序列投影到平面。
 *
 * 两个维度的量纲差着数量级（距离 0~200 km、速度 0~50 km/h），
 * 直接拿去算垂距的话，结果会被距离完全主导 —— 速度的尖峰一个都留不下来。
 * 所以各自先归一到 0~1 再比较。
 */
function projectSeries(series: SpeedSample[]): PlanePoint[] {
  let minDistance = Infinity
  let maxDistance = -Infinity
  let minSpeed = Infinity
  let maxSpeed = -Infinity
  for (const sample of series) {
    if (sample.distanceKm < minDistance) minDistance = sample.distanceKm
    if (sample.distanceKm > maxDistance) maxDistance = sample.distanceKm
    if (sample.speed < minSpeed) minSpeed = sample.speed
    if (sample.speed > maxSpeed) maxSpeed = sample.speed
  }
  const distanceRange = maxDistance - minDistance || 1
  const speedRange = maxSpeed - minSpeed || 1
  return series.map((sample) => ({
    x: (sample.distanceKm - minDistance) / distanceRange,
    y: (sample.speed - minSpeed) / speedRange,
  }))
}

/** 点到线段所在直线的垂直距离（平面坐标，单位与输入一致） */
function perpendicularDistance(point: PlanePoint, start: PlanePoint, end: PlanePoint): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) {
    const px = point.x - start.x
    const py = point.y - start.y
    return Math.sqrt(px * px + py * py)
  }
  // 用叉积求面积，再除以底边长得到高
  const cross = Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x)
  return cross / Math.sqrt(lengthSquared)
}

/**
 * Douglas-Peucker 选点。
 * 用显式栈而非递归：十万个点的极端情况下递归会爆栈，而迭代不会。
 * 返回布尔数组，true 表示该点保留。
 */
function selectByDouglasPeucker(projected: PlanePoint[], tolerance: number): boolean[] {
  const count = projected.length
  const keep = new Array<boolean>(count).fill(false)
  if (count === 0) return keep

  // 首尾一定保留 —— 起点终点丢了，轨迹与曲线在语义上就断了
  keep[0] = true
  keep[count - 1] = true
  if (count <= 2) return keep

  const stack: [number, number][] = [[0, count - 1]]
  while (stack.length > 0) {
    const segment = stack.pop()
    if (!segment) break
    const [start, end] = segment
    if (end - start < 2) continue

    let maxDistance = 0
    let farthest = -1
    for (let i = start + 1; i < end; i += 1) {
      const distance = perpendicularDistance(projected[i], projected[start], projected[end])
      if (distance > maxDistance) {
        maxDistance = distance
        farthest = i
      }
    }
    if (farthest !== -1 && maxDistance > tolerance) {
      keep[farthest] = true
      stack.push([start, farthest], [farthest, end])
    }
  }
  return keep
}

/** 兜底：万一 Douglas-Peucker 之后仍超限，做等间隔截取（并保证首尾在内） */
function evenSample<T>(items: T[], maxItems: number): T[] {
  if (items.length <= maxItems) return items
  const step = (items.length - 1) / (maxItems - 1)
  const out: T[] = []
  for (let i = 0; i < maxItems; i += 1) out.push(items[Math.round(i * step)])
  return out
}

/** 丢弃与前一个保留点几乎重合的点（起点与终点始终保留） */
function dropDuplicates(points: TrackPoint[], minMeters: number): TrackPoint[] {
  if (points.length <= 2) return points
  const minDegrees = minMeters / METERS_PER_DEGREE
  const out: TrackPoint[] = [points[0]]
  for (let i = 1; i < points.length - 1; i += 1) {
    const previous = out[out.length - 1]
    const dLat = points[i].lat - previous.lat
    const dLon = (points[i].lon - previous.lon) * Math.cos((points[i].lat * Math.PI) / 180)
    if (Math.sqrt(dLat * dLat + dLon * dLon) >= minDegrees) out.push(points[i])
  }
  out.push(points[points.length - 1])
  return out
}

/**
 * 通用：逐步放宽容差跑 Douglas-Peucker，直到点数落在上限内。
 * 轨迹与速度序列共用这段逻辑，差别只在容差的起点、上限与放大倍率。
 */
function reduceByDouglasPeucker<T>(
  items: T[],
  projected: PlanePoint[],
  options: { start: number; growth: number; max: number; maxItems: number }
): T[] {
  let tolerance = options.start
  for (let round = 0; round < 24; round += 1) {
    const keep = selectByDouglasPeucker(projected, tolerance)
    let kept = 0
    for (const flag of keep) if (flag) kept += 1

    if (kept <= options.maxItems) {
      const picked: T[] = []
      for (let i = 0; i < items.length; i += 1) if (keep[i]) picked.push(items[i])
      return picked
    }

    tolerance *= options.growth
    if (tolerance > options.max) break
  }
  return evenSample(items, options.maxItems)
}

/**
 * 把轨迹精简到不超过 maxPoints 个点。
 *
 * 默认 19500 而不是 20000：给后端的校验留一点余量，
 * 免得因为取整或后续处理多出几个点又撞上上限。
 */
export function simplifyTrack(points: TrackPoint[], maxPoints = 19_500): SimplifyResult<TrackPoint> {
  const originalCount = points.length
  if (originalCount <= maxPoints) {
    return { items: points, originalCount, simplifiedCount: originalCount, changed: false }
  }

  // 先丢掉几乎重合的点：等红灯时 GPS 抖动会堆出大量原地重复点
  const deduped = dropDuplicates(points, DUPLICATE_METERS)
  if (deduped.length <= maxPoints) {
    return { items: deduped, originalCount, simplifiedCount: deduped.length, changed: true }
  }

  const reduced = reduceByDouglasPeucker(deduped, project(deduped), {
    start: TRACK_TOLERANCE_START_METERS / METERS_PER_DEGREE,
    growth: TOLERANCE_GROWTH,
    max: TRACK_TOLERANCE_MAX_METERS / METERS_PER_DEGREE,
    maxItems: maxPoints,
  })
  const finalItems = reduced.length <= maxPoints ? reduced : evenSample(reduced, maxPoints)
  return {
    items: finalItems,
    originalCount,
    simplifiedCount: finalItems.length,
    changed: finalItems.length < originalCount,
  }
}

/**
 * 把速度序列精简到不超过 maxPoints 个采样点。
 *
 * ⚠️ 这是与轨迹**并列的另一条限制**，不是"顺便处理一下"：
 * 服务端各查各的，只抽稀轨迹的话，三万个采样点的速度序列照样会被拦下来，
 * 用户看到的报错会从「轨迹点过多」变成「速度序列过长」。
 */
export function simplifySpeedSeries(
  series: SpeedSample[],
  maxPoints = 19_500
): SimplifyResult<SpeedSample> {
  const originalCount = series.length
  if (originalCount <= maxPoints) {
    return { items: series, originalCount, simplifiedCount: originalCount, changed: false }
  }

  const reduced = reduceByDouglasPeucker(series, projectSeries(series), {
    start: SERIES_TOLERANCE_START,
    growth: TOLERANCE_GROWTH,
    max: SERIES_TOLERANCE_MAX,
    maxItems: maxPoints,
  })
  const finalItems = reduced.length <= maxPoints ? reduced : evenSample(reduced, maxPoints)
  return {
    items: finalItems,
    originalCount,
    simplifiedCount: finalItems.length,
    changed: finalItems.length < originalCount,
  }
}

export interface RideSimplifyResult {
  ride: RideRecord
  changed: boolean
  track: SimplifyResult<TrackPoint>
  series: SimplifyResult<SpeedSample>
}

/**
 * 一次把一条记录的两处上限都处理好（轨迹 + 速度序列）。
 *
 * 调用方**应该用这个**，而不是单独调 `simplifyTrack` ——
 * 漏掉任何一个，用户依然存不进去。
 *
 * 已经是小数据时两个返回值都是原对象引用，所以这次调用几乎零开销。
 */
export function simplifyRide(ride: RideRecord, maxPoints = 19_500): RideSimplifyResult {
  const track = simplifyTrack(ride.track ?? [], maxPoints)
  const series = simplifySpeedSeries(ride.speedSeries ?? [], maxPoints)
  return {
    ride: track.changed || series.changed ? { ...ride, track: track.items, speedSeries: series.items } : ride,
    changed: track.changed || series.changed,
    track,
    series,
  }
}

/** 供界面提示："已自动精简：轨迹点 30000 → 1296，速度采样 30000 → 2108" */
export function describeSimplification(result: RideSimplifyResult): string {
  if (!result.changed) return ''
  const parts: string[] = []
  if (result.track.changed) {
    parts.push(`轨迹点 ${result.track.originalCount} → ${result.track.simplifiedCount}`)
  }
  if (result.series.changed) {
    parts.push(`速度采样 ${result.series.originalCount} → ${result.series.simplifiedCount}`)
  }
  return `已自动精简：${parts.join('，')}`
}
