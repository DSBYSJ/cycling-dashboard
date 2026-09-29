import type { TrackPoint } from '../types'

/**
 * 设备写在 `<extensions>` 里的官方统计。
 *
 * 华为运动健康（HUAWEI Health）导出 GPX 时会带上这一组，**比我们自己算的更权威**：
 *   <extensions><totalTime>25184.0</totalTime><totalDistance>117320.0</totalDistance>
 *               <cumulativeClimb>463.1</cumulativeClimb></extensions>
 *
 * 尤其 `totalTime` 是**运动时长**，通常已排除长时间停留 —— 这正是它与
 * "首尾时间戳之差"最大的区别（实测一份记录：首尾跨度 10.2 小时，运动时长只有 7.0 小时，
 * 直接拿首尾差算均速会把 17.1 km/h 算成 11.8 km/h）。
 *
 * 其它来源的 GPX 可能没有这些标签，所以一律**有则优先、无则回落到自己算**。
 */
export interface GpxStats {
  distanceMeters: number | null
  durationSeconds: number | null
  climbMeters: number | null
}

/** 读取 <extensions> 里的一个统计值；不存在或不合法的返回 null */
function readExtension(doc: Document, tag: string): number | null {
  const node = doc.getElementsByTagName(tag)[0]
  if (!node) return null
  const value = Number.parseFloat(node.textContent ?? '')
  return Number.isFinite(value) && value > 0 ? value : null
}

/** 用 DOMParser 解析 GPX 文本,提取轨迹点(lat/lon/ele/time)与设备统计 */
export function parseGPX(xml: string): { points: TrackPoint[]; name?: string; stats: GpxStats } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('GPX 文件格式无效（XML 解析失败）')
  const nodes = Array.from(doc.getElementsByTagName('trkpt'))
  if (nodes.length === 0) throw new Error('GPX 文件中没有轨迹点（trkpt）')
  const points: TrackPoint[] = []
  for (const node of nodes) {
    const lat = parseFloat(node.getAttribute('lat') ?? '')
    const lon = parseFloat(node.getAttribute('lon') ?? '')
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const eleNode = node.getElementsByTagName('ele')[0]
    const timeNode = node.getElementsByTagName('time')[0]
    points.push({
      lat,
      lon,
      ele: eleNode ? parseFloat(eleNode.textContent ?? '') : undefined,
      time: timeNode?.textContent?.trim() || undefined,
    })
  }
  if (points.length < 2) throw new Error('有效轨迹点不足（至少需要 2 个）')
  const nameNode = doc.getElementsByTagName('name')[0]
  const stats: GpxStats = {
    distanceMeters: readExtension(doc, 'totalDistance'),
    durationSeconds: readExtension(doc, 'totalTime'),
    climbMeters: readExtension(doc, 'cumulativeClimb'),
  }
  return { points, name: nameNode?.textContent?.trim() || undefined, stats }
}

/** 球面距离(Haversine),米 */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** 轨迹总距离,米 */
export function trackDistanceMeters(points: TrackPoint[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon)
  }
  return total
}

/** 累计爬升,米(过滤 <1m 的噪声波动) */
export function elevationGainMeters(points: TrackPoint[]): number {
  let gain = 0
  let prev: number | null = null
  for (const p of points) {
    if (p.ele == null || !Number.isFinite(p.ele)) continue
    if (prev != null && p.ele - prev > 1) gain += p.ele - prev
    if (prev == null || Math.abs(p.ele - prev) > 1) prev = p.ele
  }
  return Math.round(gain)
}

/** 速度的物理上限（km/h）—— 只作为兜底，真正的去噪交给中位数滤波 */
const MAX_PLAUSIBLE_SPEED = 100

/**
 * 速度序列的中位数滤波窗口（采样点数）。
 * 1 秒采样下取 5，即"前后各 2 秒"。
 */
const SPEED_MEDIAN_WINDOW = 5

/**
 * 中位数滤波。
 *
 * **为什么必须做**：1 秒采样的单段速度噪声极大，一次 GPS 漂移就能算出 90+ km/h。
 * 实测一份 3.5 万点的华为 GPX：全程真实速度在 20~35 km/h，
 * 却有 4 段算出 72~92 km/h —— 都是孤立点（前后段都正常），是漂移不是下坡。
 *
 * **为什么用中位数而不是平均值**：平均值会被漂移点本身拉高 ——
 * 比如 (20, 25, 92, 72, 30) 平均是 47.8（仍明显偏高），中位数则是 30（接近真实）。
 *
 * 代价：真实的高频变化（一两秒的冲刺）会被削平。但在 1 秒粒度上，
 * 那点起伏本来就分不清是冲刺还是噪声 —— 取更稳的那个更合理。
 */
function medianFilter(values: number[], window: number): number[] {
  if (window <= 1 || values.length === 0) return values
  const half = Math.floor(window / 2)
  const out: number[] = []
  for (let i = 0; i < values.length; i += 1) {
    const slice: number[] = []
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j += 1) {
      // 速度为 0 表示"这一段没有时间戳 / 没动"，让它参与会把真实速度拉低
      if (values[j] > 0) slice.push(values[j])
    }
    if (slice.length === 0) {
      out.push(values[i])
      continue
    }
    slice.sort((a, b) => a - b)
    const mid = Math.floor(slice.length / 2)
    out.push(slice.length % 2 === 1 ? slice[mid] : Math.round(((slice[mid - 1] + slice[mid]) / 2) * 10) / 10)
  }
  return out
}

/** 速度序列:相邻轨迹点由时间+距离计算,km/h;返回累计距离(km)与速度 */
export function speedSeriesFromTrack(points: TrackPoint[]): { distanceKm: number; speed: number }[] {
  const distances: number[] = []
  const rawSpeeds: number[] = []
  let cumulative = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const segMeters = haversine(a.lat, a.lon, b.lat, b.lon)
    cumulative += segMeters
    let speed = 0
    if (a.time && b.time) {
      const dt = (Date.parse(b.time) - Date.parse(a.time)) / 1000
      if (dt > 0) speed = Math.min(MAX_PLAUSIBLE_SPEED, (segMeters / dt) * 3.6)
    }
    distances.push(cumulative / 1000)
    rawSpeeds.push(speed)
  }
  const smoothed = medianFilter(rawSpeeds, SPEED_MEDIAN_WINDOW)
  return distances.map((distanceKm, i) => ({ distanceKm, speed: smoothed[i] }))
}

/**
 * 从速度序列取最高速度。
 * 入参已经是平滑过的序列（见 speedSeriesFromTrack），所以这里可以直接取最大值 ——
 * GPS 漂移造成的孤立尖峰在平滑那一步就已经被削掉了。
 */
export function maxSpeedFromSeries(series: { speed: number }[]): number | null {
  const values = series.map((s) => s.speed).filter((v) => v > 0)
  if (!values.length) return null
  return Math.round(Math.max(...values) * 10) / 10
}

/** GPX 轨迹统计:距离 km、爬升 m、平均坡度 %、起终点 */
export function summarizeTrack(points: TrackPoint[]): {
  distanceKm: number
  elevationGain: number
  avgGrade: number | null
  start: { lat: number; lon: number }
  end: { lat: number; lon: number }
} {
  const distanceKm = trackDistanceMeters(points) / 1000
  const elevationGain = elevationGainMeters(points)
  const hasEle = points.some((p) => p.ele != null)
  return {
    distanceKm: Math.round(distanceKm * 100) / 100,
    elevationGain,
    avgGrade: hasEle ? Math.round((elevationGain / Math.max(1, distanceKm * 1000)) * 10000) / 100 : null,
    start: { lat: points[0].lat, lon: points[0].lon },
    end: { lat: points[points.length - 1].lat, lon: points[points.length - 1].lon },
  }
}
