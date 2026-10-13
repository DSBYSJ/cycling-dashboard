import type {
  Bike,
  BikeCategoryId,
  DayCheckIn,
  EnvData,
  RideRecord,
  RouteInfo,
  Scores,
  SurfaceType,
  TrackPoint,
  TrafficLevel,
} from '../types'
import { BIKE_CATEGORIES, TIRE_TYPES } from '../types'

export const BACKUP_APP = 'cycling-dashboard'
/** 备份文件格式版本;结构变更时递增,并在 normalize 里做兼容处理 */
export const BACKUP_VERSION = 1

export interface BackupPayload {
  app: string
  version: number
  exportedAt: string
  rides: RideRecord[]
  bikes: Bike[]
  days: DayCheckIn[]
}

export interface ImportSummary {
  rides: RideRecord[]
  bikes: Bike[]
  days: DayCheckIn[]
  /** 格式不合法被跳过的条数 */
  skipped: { rides: number; bikes: number; days: number }
}

export type ParseResult =
  | { ok: true; summary: ImportSummary }
  | { ok: false; error: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SURFACES: SurfaceType[] = ['asphalt', 'cement', 'gravel', 'mixed']
const TRAFFICS: TrafficLevel[] = ['low', 'medium', 'high']

/** 本地时区的今天（YYYY-MM-DD）—— 全站日期口径一致，不用 UTC 免得起止差一天 */
function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ---------------- 基础取值助手 ---------------- */

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 可空数字:非法值统一归一为 null,避免脏数据把图表算崩 */
function nullableNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function optionalNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function optionalStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined
}

function bool(v: unknown): boolean {
  return v === true
}

/* ---------------- 结构化字段归一 ---------------- */

function normalizeEnv(v: unknown): EnvData {
  const o = isObj(v) ? v : {}
  return {
    temperature: nullableNum(o.temperature),
    windLevel: nullableNum(o.windLevel),
    humidity: nullableNum(o.humidity),
    precipitation: nullableNum(o.precipitation),
    precipitationProbability: nullableNum(o.precipitationProbability),
    aqi: nullableNum(o.aqi),
    pm25: nullableNum(o.pm25),
  }
}

function normalizeRoute(v: unknown): RouteInfo {
  const o = isObj(v) ? v : {}
  return {
    elevationGain: nullableNum(o.elevationGain),
    avgGrade: nullableNum(o.avgGrade),
    surface: SURFACES.includes(o.surface as SurfaceType) ? (o.surface as SurfaceType) : null,
    traffic: TRAFFICS.includes(o.traffic as TrafficLevel) ? (o.traffic as TrafficLevel) : null,
  }
}

function normalizeTrack(v: unknown): TrackPoint[] {
  if (!Array.isArray(v)) return []
  const out: TrackPoint[] = []
  for (const item of v) {
    if (!isObj(item)) continue
    const lat = nullableNum(item.lat)
    const lon = nullableNum(item.lon)
    if (lat == null || lon == null) continue
    out.push({ lat, lon, ele: optionalNum(item.ele), time: optionalStr(item.time) })
  }
  return out
}

function normalizeSpeedSeries(v: unknown): { distanceKm: number; speed: number }[] {
  if (!Array.isArray(v)) return []
  const out: { distanceKm: number; speed: number }[] = []
  for (const item of v) {
    if (!isObj(item)) continue
    const distanceKm = nullableNum(item.distanceKm)
    const speed = nullableNum(item.speed)
    if (distanceKm == null || speed == null) continue
    out.push({ distanceKm, speed })
  }
  return out
}

function normalizeScores(v: unknown): Scores | null {
  if (!isObj(v)) return null
  const total = nullableNum(v.total)
  const weather = nullableNum(v.weather)
  const route = nullableNum(v.route)
  if (total == null || weather == null || route == null) return null
  return { total, weather, route, rainFactor: nullableNum(v.rainFactor) ?? 0 }
}

function normalizeStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
}

/* ---------------- 各表归一 + 校验 ---------------- */

function normalizeRide(v: unknown): RideRecord | null {
  if (!isObj(v)) return null
  const id = optionalStr(v.id)
  const date = str(v.date)
  if (!id || !DATE_RE.test(date)) return null
  const created = optionalNum(v.createdAt) ?? Date.now()
  const envMeta = isObj(v.envMeta) ? v.envMeta : {}
  const cityCode = str(v.cityCode)

  return {
    id,
    label: optionalStr(v.label),
    bikeId: optionalStr(v.bikeId),
    checkIn: v.checkIn === true ? true : undefined,
    date,
    durationMin: nullableNum(v.durationMin),
    distanceKm: nullableNum(v.distanceKm),
    avgSpeed: nullableNum(v.avgSpeed),
    maxSpeed: nullableNum(v.maxSpeed),
    cityName: str(v.cityName),
    cityCode,
    startName: optionalStr(v.startName),
    startDistrict: optionalStr(v.startDistrict),
    location: isObj(v.location) && nullableNum(v.location.lat) != null && nullableNum(v.location.lon) != null
      ? { lat: nullableNum(v.location.lat) as number, lon: nullableNum(v.location.lon) as number }
      : null,
    env: normalizeEnv(v.env),
    envMeta: {
      weatherFetched: bool(envMeta.weatherFetched),
      aqiFetched: bool(envMeta.aqiFetched),
      manualEdited: bool(envMeta.manualEdited),
      weatherError: optionalStr(envMeta.weatherError),
      aqiError: optionalStr(envMeta.aqiError),
      weatherNote: optionalStr(envMeta.weatherNote),
      aqiSource: optionalStr(envMeta.aqiSource),
    },
    route: normalizeRoute(v.route),
    track: normalizeTrack(v.track),
    routeName: optionalStr(v.routeName),
    speedSeries: normalizeSpeedSeries(v.speedSeries),
    scores: normalizeScores(v.scores),
    comment: str(v.comment),
    suggestions: normalizeStringList(v.suggestions),
    notes: str(v.notes),
    createdAt: created,
    updatedAt: optionalNum(v.updatedAt) ?? created,
  }
}

function normalizeBike(v: unknown): Bike | null {
  if (!isObj(v)) return null
  const id = optionalStr(v.id)
  const name = optionalStr(v.name)
  if (!id || !name) return null
  const created = optionalNum(v.createdAt) ?? Date.now()
  const category = (typeof v.category === 'string' && v.category in BIKE_CATEGORIES
    ? v.category
    : 'other') as BikeCategoryId
  const tireTypeId = TIRE_TYPES.some((t) => t.id === v.tireTypeId)
    ? (v.tireTypeId as string)
    : TIRE_TYPES[0].id
  const installedAt = str(v.tireInstalledAt)

  return {
    id,
    name,
    category,
    tireTypeId,
    // 缺失时用**本地日期**而不是 UTC（东八区凌晨会差一天，见 server 侧 todayLocal）
    tireInstalledAt: DATE_RE.test(installedAt) ? installedAt : todayLocal(),
    tireStartKm: nullableNum(v.tireStartKm) ?? 0,
    notes: optionalStr(v.notes),
    createdAt: created,
    updatedAt: optionalNum(v.updatedAt) ?? created,
  }
}

function normalizeDay(v: unknown): DayCheckIn | null {
  if (!isObj(v)) return null
  const date = str(v.date)
  const id = optionalStr(v.id) ?? (DATE_RE.test(date) ? date : undefined)
  if (!id || !DATE_RE.test(date)) return null
  return {
    id,
    date,
    rode: bool(v.rode),
    bikeId: optionalStr(v.bikeId),
    distanceKm: optionalNum(v.distanceKm),
    rideId: optionalStr(v.rideId),
    note: optionalStr(v.note),
    createdAt: optionalNum(v.createdAt) ?? Date.now(),
  }
}

function normalizeList<T>(raw: unknown, normalize: (v: unknown) => T | null): { items: T[]; skipped: number } {
  if (!Array.isArray(raw)) return { items: [], skipped: 0 }
  const items: T[] = []
  let skipped = 0
  for (const item of raw) {
    const normalized = normalize(item)
    if (normalized) items.push(normalized)
    else skipped += 1
  }
  return { items, skipped }
}

/**
 * 解析并校验备份文件。
 * 逐条归一化:字段缺失按默认值补齐,彻底不可用的记录(缺 id / 日期非法 / 结构错误)被跳过并计数,
 * 不会因为一条脏数据导致整次导入失败,也不会把非法结构写进数据库。
 */
export function parseBackup(raw: unknown): ParseResult {
  if (!isObj(raw)) return { ok: false, error: '文件内容不是有效的 JSON 对象' }
  if (raw.app != null && raw.app !== BACKUP_APP) {
    return { ok: false, error: '这不是本应用导出的备份文件' }
  }

  const rides = normalizeList(raw.rides, normalizeRide)
  const bikes = normalizeList(raw.bikes, normalizeBike)
  const days = normalizeList(raw.days, normalizeDay)

  const total = rides.items.length + bikes.items.length + days.items.length
  const skippedTotal = rides.skipped + bikes.skipped + days.skipped
  if (total === 0) {
    return {
      ok: false,
      error: skippedTotal > 0
        ? `备份文件里的 ${skippedTotal} 条数据格式不合法,均无法导入`
        : '备份文件里没有可导入的数据',
    }
  }

  return {
    ok: true,
    summary: {
      rides: rides.items,
      bikes: bikes.items,
      days: days.items,
      skipped: { rides: rides.skipped, bikes: bikes.skipped, days: days.skipped },
    },
  }
}

/** 生成备份载荷 */
export function createBackup(rides: RideRecord[], bikes: Bike[], days: DayCheckIn[]): BackupPayload {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    rides,
    bikes,
    days,
  }
}
