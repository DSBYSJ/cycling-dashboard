import type {
  Bike,
  BikeCategoryId,
  DayCheckIn,
  EnvData,
  EnvMeta,
  RideRecord,
  RouteInfo,
  Scores,
  SurfaceType,
  TrackPoint,
  TrafficLevel,
} from '../../../src/types.ts'
import { BIKE_CATEGORIES, TIRE_TYPES } from '../../../src/types.ts'
import { badRequest } from './errors.ts'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/password.ts'

/**
 * 入参校验与归一化。
 *
 * 这里是服务端的唯一可信入口:前端传什么都不能直接进库。
 * 类型定义复用前端的 src/types.ts(相对路径直接引用)，保证两端模型不会各自漂移;
 * 但**校验规则以本文件为准** —— 前端校验只是为了体验，服务端校验才是安全边界。
 */

/* ---------------- 上限:防止超大/畸形数据打爆磁盘与内存 ---------------- */
const LIMITS = {
  idLength: 64,
  trackPoints: 20_000,
  seriesPoints: 20_000,
  suggestions: 50,
  textLength: 5_000,
  shortText: 500,
  distanceKm: 10_000,
  durationMin: 100_000,
  speed: 300,
  elevationGain: 30_000,
} as const

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** 邮箱形态:不追求 RFC 完备，只拦住明显不合法的输入 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
/**
 * 纯用户名形态（不含 @）。账号标识同时接受邮箱与用户名，
 * 是为了让「admin」这类简短账号也能用（运营者自己的需求）。
 * 限定字母开头、只含字母/数字/下划线/连字符，避免出现怪字符与前后空格。
 */
const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/

const SURFACES: SurfaceType[] = ['asphalt', 'cement', 'gravel', 'mixed']
const TRAFFICS: TrafficLevel[] = ['low', 'medium', 'high']

/* ---------------- 基础类型助手 ---------------- */

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function fail(message: string): never {
  throw badRequest(message)
}

/** 可空数字:非法值归一为 null */
function nullableNum(v: unknown, min: number, max: number, field: string): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) fail(`${field} 必须是数字`)
  if (n < min || n > max) fail(`${field} 超出合理范围（${min} ~ ${max}）`)
  return n
}

/**
 * 宽松数字:不合法或越界都返回 null，由调用方决定「剔除这一项」。
 * 轨迹点用它是刻意的 —— GPX 里偶尔出现 (0,0) 或坐标越界的脏点很常见，
 * 不该因为一个点就把整条轨迹判定为非法。
 */
function lenientNum(v: unknown, min: number, max: number): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  return n >= min && n <= max ? n : null
}

function optionalNum(v: unknown, field: string): number | undefined {
  if (v == null) return undefined
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) fail(`${field} 必须是数字`)
  return n
}

function requiredStr(v: unknown, field: string, maxLength: number = LIMITS.shortText): string {
  if (typeof v !== 'string' || v.trim() === '') fail(`缺少 ${field}`)
  const s = v as string
  if (s.length > maxLength) fail(`${field} 过长（上限 ${maxLength} 字符）`)
  return s
}

function str(v: unknown, maxLength: number = LIMITS.textLength): string {
  if (typeof v !== 'string') return ''
  return v.length > maxLength ? v.slice(0, maxLength) : v
}

function optionalStr(v: unknown, maxLength: number = LIMITS.shortText): string | undefined {
  if (typeof v !== 'string') return undefined
  const trimmed = v.trim()
  if (trimmed === '') return undefined
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function requireId(v: unknown, field: string): string {
  const id = requiredStr(v, field, LIMITS.idLength)
  if (!ID_RE.test(id)) fail(`${field} 只能包含字母、数字、下划线和短横线`)
  return id
}

function requireDate(v: unknown, field = 'date'): string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) fail(`${field} 必须是 YYYY-MM-DD 格式`)
  return v as string
}

/* ---------------- 结构化字段 ---------------- */

function normalizeEnv(v: unknown): EnvData {
  const o = isObj(v) ? v : {}
  return {
    temperature: nullableNum(o.temperature, -80, 60, '气温'),
    windLevel: nullableNum(o.windLevel, 0, 17, '风力'),
    humidity: nullableNum(o.humidity, 0, 100, '湿度'),
    precipitation: nullableNum(o.precipitation, 0, 2_000, '降水量'),
    precipitationProbability: nullableNum(o.precipitationProbability, 0, 100, '降雨概率'),
    aqi: nullableNum(o.aqi, 0, 1_000, 'AQI'),
    pm25: nullableNum(o.pm25, 0, 2_000, 'PM2.5'),
  }
}

function normalizeEnvMeta(v: unknown): EnvMeta {
  const o = isObj(v) ? v : {}
  return {
    weatherFetched: o.weatherFetched === true,
    aqiFetched: o.aqiFetched === true,
    manualEdited: o.manualEdited === true,
    weatherError: optionalStr(o.weatherError),
    aqiError: optionalStr(o.aqiError),
    weatherNote: optionalStr(o.weatherNote),
    aqiSource: optionalStr(o.aqiSource),
  }
}

function normalizeRoute(v: unknown): RouteInfo {
  const o = isObj(v) ? v : {}
  return {
    elevationGain: nullableNum(o.elevationGain, 0, LIMITS.elevationGain, '累计爬升'),
    avgGrade: nullableNum(o.avgGrade, -50, 100, '平均坡度'),
    surface: SURFACES.includes(o.surface as SurfaceType) ? (o.surface as SurfaceType) : null,
    traffic: TRAFFICS.includes(o.traffic as TrafficLevel) ? (o.traffic as TrafficLevel) : null,
  }
}

function normalizeTrack(v: unknown): TrackPoint[] {
  if (v == null) return []
  if (!Array.isArray(v)) fail('track 必须是数组')
  const arr = v as unknown[]
  if (arr.length > LIMITS.trackPoints) fail(`轨迹点过多（上限 ${LIMITS.trackPoints} 个）`)
  const out: TrackPoint[] = []
  for (const item of arr) {
    if (!isObj(item)) continue
    const lat = lenientNum(item.lat, -90, 90)
    const lon = lenientNum(item.lon, -180, 180)
    if (lat == null || lon == null) continue
    out.push({ lat, lon, ele: lenientNum(item.ele, -500, 9000) ?? undefined, time: optionalStr(item.time, 40) })
  }
  return out
}

function normalizeSpeedSeries(v: unknown): { distanceKm: number; speed: number }[] {
  if (v == null) return []
  if (!Array.isArray(v)) fail('speedSeries 必须是数组')
  const arr = v as unknown[]
  if (arr.length > LIMITS.seriesPoints) fail(`速度序列过长（上限 ${LIMITS.seriesPoints} 个点）`)
  const out: { distanceKm: number; speed: number }[] = []
  for (const item of arr) {
    if (!isObj(item)) continue
    const distanceKm = lenientNum(item.distanceKm, 0, LIMITS.distanceKm)
    const speed = lenientNum(item.speed, 0, LIMITS.speed)
    if (distanceKm == null || speed == null) continue
    out.push({ distanceKm, speed })
  }
  return out
}

function normalizeScores(v: unknown): Scores | null {
  if (!isObj(v)) return null
  const total = nullableNum(v.total, 0, 100, '综合评分')
  const weather = nullableNum(v.weather, 0, 100, '天气评分')
  const route = nullableNum(v.route, 0, 100, '路线评分')
  if (total == null || weather == null || route == null) return null
  return { total, weather, route, rainFactor: nullableNum(v.rainFactor, 0, 1_000, '降雨指数') ?? 0 }
}

function normalizeStringList(v: unknown, field: string, maxLength: number): string[] {
  if (v == null) return []
  if (!Array.isArray(v)) fail(`${field} 必须是数组`)
  const arr = v as unknown[]
  if (arr.length > LIMITS.suggestions) fail(`${field} 条数过多`)
  return arr.filter((s): s is string => typeof s === 'string').map((s) => s.slice(0, maxLength))
}

/* ---------------- 对外校验函数 ---------------- */

export interface NormalizedRide extends Omit<RideRecord, 'id'> {
  id: string
}

/** 校验并归一化一条骑行记录 */
export function validateRide(v: unknown): NormalizedRide {
  if (!isObj(v)) fail('请求体必须是一个对象')
  const created = optionalNum(v.createdAt, 'createdAt') ?? Date.now()
  const rawLocation = isObj(v.location) ? v.location : null
  const lat = rawLocation ? nullableNum(rawLocation.lat, -90, 90, '起点纬度') : null
  const lon = rawLocation ? nullableNum(rawLocation.lon, -180, 180, '起点经度') : null

  return {
    id: requireId(v.id, 'id'),
    label: optionalStr(v.label),
    bikeId: optionalStr(v.bikeId),
    checkIn: v.checkIn === true ? true : undefined,
    date: requireDate(v.date),
    durationMin: nullableNum(v.durationMin, 0, LIMITS.durationMin, '时长'),
    distanceKm: nullableNum(v.distanceKm, 0, LIMITS.distanceKm, '距离'),
    avgSpeed: nullableNum(v.avgSpeed, 0, LIMITS.speed, '平均速度'),
    maxSpeed: nullableNum(v.maxSpeed, 0, LIMITS.speed, '最高速度'),
    cityName: str(v.cityName, LIMITS.shortText),
    cityCode: str(v.cityCode, LIMITS.shortText),
    startName: optionalStr(v.startName),
    startDistrict: optionalStr(v.startDistrict),
    location: lat != null && lon != null ? { lat, lon } : null,
    env: normalizeEnv(v.env),
    envMeta: normalizeEnvMeta(v.envMeta),
    route: normalizeRoute(v.route),
    track: normalizeTrack(v.track),
    routeName: optionalStr(v.routeName),
    speedSeries: normalizeSpeedSeries(v.speedSeries),
    scores: normalizeScores(v.scores),
    comment: str(v.comment),
    suggestions: normalizeStringList(v.suggestions, 'suggestions', LIMITS.shortText),
    notes: str(v.notes),
    createdAt: Math.round(created),
    updatedAt: Math.round(optionalNum(v.updatedAt, 'updatedAt') ?? created),
  }
}

export function validateBike(v: unknown): Bike {
  if (!isObj(v)) fail('请求体必须是一个对象')
  const created = optionalNum(v.createdAt, 'createdAt') ?? Date.now()
  const category = (typeof v.category === 'string' && v.category in BIKE_CATEGORIES
    ? v.category
    : 'other') as BikeCategoryId
  const tireTypeId = TIRE_TYPES.some((t) => t.id === v.tireTypeId)
    ? (v.tireTypeId as string)
    : TIRE_TYPES[0].id
  const installedAt = typeof v.tireInstalledAt === 'string' && DATE_RE.test(v.tireInstalledAt)
    ? v.tireInstalledAt
    : new Date().toISOString().slice(0, 10)

  return {
    id: requireId(v.id, 'id'),
    name: requiredStr(v.name, '单车名称', LIMITS.shortText),
    category,
    tireTypeId,
    tireInstalledAt: installedAt,
    tireStartKm: nullableNum(v.tireStartKm, 0, LIMITS.distanceKm, '外胎安装里程') ?? 0,
    notes: optionalStr(v.notes, LIMITS.textLength),
    createdAt: Math.round(created),
    updatedAt: Math.round(optionalNum(v.updatedAt, 'updatedAt') ?? created),
  }
}

export function validateDay(v: unknown): DayCheckIn {
  if (!isObj(v)) fail('请求体必须是一个对象')
  const date = requireDate(v.date)
  const id = typeof v.id === 'string' && ID_RE.test(v.id) ? v.id : date
  return {
    id,
    date,
    rode: v.rode === true,
    bikeId: optionalStr(v.bikeId),
    distanceKm: optionalNum(v.distanceKm, 'distanceKm'),
    rideId: optionalStr(v.rideId),
    note: optionalStr(v.note, LIMITS.textLength),
    createdAt: Math.round(optionalNum(v.createdAt, 'createdAt') ?? Date.now()),
  }
}

/** ---------------- 账号相关 ---------------- */

/**
 * 账号标识归一化:去空白 + 转小写(库里的唯一索引是 NOCASE，两端一致)。
 *
 * 同时接受两种形态:
 *   · 邮箱    —— rider@example.com
 *   · 用户名  —— admin（不含 @，字母开头，字母/数字/下划线/连字符，3–30 位）
 *
 * 数据库字段名仍是 `email`（历史原因，改列名要动唯一索引与既有数据），
 * 但语义已经是「账号标识」。
 */
export function normalizeAccount(v: unknown): string {
  if (typeof v !== 'string') fail('请输入账号')
  const account = (v as string).trim().toLowerCase()
  if (account.length > 254) fail('账号过长')
  if (!EMAIL_RE.test(account) && !USERNAME_RE.test(account)) {
    fail('请输入邮箱或用户名（用户名只能含字母、数字、下划线、连字符）')
  }
  return account
}

export function validatePassword(v: unknown): string {
  if (typeof v !== 'string') fail('请输入密码')
  const password = v as string
  if (password.length < PASSWORD_MIN_LENGTH) fail(`密码至少 ${PASSWORD_MIN_LENGTH} 位`)
  if (password.length > PASSWORD_MAX_LENGTH) fail(`密码最长 ${PASSWORD_MAX_LENGTH} 位`)
  return password
}

/* ---------------- 分页参数 ---------------- */

/** 宽松解析:查询串里的分页参数不合法时退回默认值，而不是让一次读取请求 400 */
function intOrNull(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

export function parsePagination(query: unknown, defaultLimit: number = 200): { limit: number; offset: number } {
  const q = isObj(query) ? query : {}
  const limitRaw = intOrNull(q.limit)
  const offsetRaw = intOrNull(q.offset)
  // 上限 500:一次响应最多几百条，避免被人用 limit=999999 拖垮内存
  const limit = limitRaw == null ? defaultLimit : Math.min(Math.max(limitRaw, 1), 500)
  const offset = offsetRaw == null ? 0 : Math.max(offsetRaw, 0)
  return { limit, offset }
}
