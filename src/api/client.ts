import type { Bike, DayCheckIn, RideRecord } from '../types'

/**
 * 后端 API 客户端。
 *
 * 三条设计原则：
 *  1. **登录态走 httpOnly Cookie**，所以每个请求都要 `credentials: 'include'`；
 *     前端拿不到也存不了令牌 —— 这是 XSS 偷不走登录态的前提。
 *  2. **区分「网络不通」与「后端返回了错误」**。前者可重试、可离线降级，
 *     后者要按 code 给用户明确提示（比如 email_taken）。混在一起会让界面只能显示「失败」。
 *  3. 错误码集中在 `code` 字段上判断，不靠 HTTP 状态码猜 —— 后端改了状态码也不会影响前端逻辑。
 */

/** 后端会返回的错误码（server/src/lib/errors.ts），未知码按字符串透传 */
export const API_ERROR_CODES = {
  unauthorized: 'unauthorized',
  sessionExpired: 'session_expired',
  invalidCredentials: 'invalid_credentials',
  emailTaken: 'email_taken',
  registerDisabled: 'register_disabled',
  invalidRequest: 'invalid_request',
  notFound: 'not_found',
  forbidden: 'forbidden',
  rateLimited: 'rate_limited',
  serverError: 'server_error',
} as const

/** 后端明确返回的业务错误 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }

  /** 登录态失效：界面据此跳回登录页，而不是报「保存失败」 */
  get isAuthFailure(): boolean {
    return this.code === API_ERROR_CODES.sessionExpired || this.code === API_ERROR_CODES.unauthorized
  }
}

/** 请求根本没到后端（离线 / 被中断 / DNS 失败），与业务错误区分开 */
export class NetworkError extends Error {
  constructor(message = '网络不可用，请检查网络连接后重试') {
    super(message)
    this.name = 'NetworkError'
  }
}

export interface PublicUser {
  id: number
  email: string
  displayName: string | null
  createdAt: string
}

/**
 * 登录态查询结果。
 * isAdmin / feedbackEnabled 只用来决定**界面显示**（要不要给管理员入口、留言入口），
 * 真正的权限一律在后端判 —— 前端藏起来不等于没权限。
 */
export interface MeResult {
  user: PublicUser
  isAdmin: boolean
  feedbackEnabled: boolean
}

/** 用户 → 站长的单向留言：只能看到自己提交的与站长给自己的回复 */
export interface FeedbackItem {
  id: number
  userId: number
  content: string
  status: 'open' | 'done'
  reply: string | null
  repliedAt: string | null
  createdAt: string
}

/**
 * 列表接口不返回轨迹，只给这个标记；点开详情再取完整轨迹。
 * 标记设为可选：本地新建、还没提交的记录天然没有这个字段。
 */
export type RideListItem = RideRecord & { hasTrack?: boolean }

export interface ListResult<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface BulkResult {
  imported: number
  skipped: number
}

export interface BootstrapData {
  user: PublicUser
  bikes: Bike[]
  days: DayCheckIn[]
  rides: ListResult<RideListItem>
}

// 同源部署时为空串（请求 /api/...）；本地开发由 vite 代理转发；
// 以后打包成 App 若跨域，用 VITE_API_BASE 指定后端地址。
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')

export function apiUrl(path: string): string {
  return `${API_BASE}/api${path}`
}

interface RequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

function buildQuery(path: string, params?: Record<string, string | number | undefined>): string {
  if (!params) return path
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `${path}?${qs}` : path
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 20_000
  // AbortSignal.timeout 在旧浏览器上不存在，退化成不设超时而不是崩掉
  const timeoutSignal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined
  const signal = options.signal ?? timeoutSignal

  let res: Response
  try {
    res = await fetch(apiUrl(path), {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (err) {
    // 调用方主动取消（切换页面等）要原样抛出，不能当成网络故障提示用户
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new NetworkError()
  }

  // 退出登录、改密码、删除成功都返回 204，没有响应体
  if (res.status === 204) return undefined as T

  const text = await res.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!res.ok) {
    const info = (payload as { error?: { code?: unknown; message?: unknown } } | null)?.error
    const code = typeof info?.code === 'string' ? info.code : API_ERROR_CODES.serverError
    const message = typeof info?.message === 'string' ? info.message : `请求失败（HTTP ${res.status}）`
    throw new ApiError(res.status, code, message)
  }

  return payload as T
}

export const api = {
  health: () => request<{ ok: boolean; time: string }>('GET', '/health'),
  bootstrap: () => request<BootstrapData>('GET', '/bootstrap'),

  register: (email: string, password: string) =>
    request<MeResult>('POST', '/auth/register', { email, password }),
  login: (email: string, password: string) =>
    request<MeResult>('POST', '/auth/login', { email, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  me: () => request<MeResult>('GET', '/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('POST', '/auth/password', { currentPassword, newPassword }),

  listRides: (params?: { limit?: number; offset?: number }) =>
    request<ListResult<RideListItem>>('GET', buildQuery('/rides', params)),
  getRide: (id: string) => request<{ ride: RideRecord }>('GET', `/rides/${encodeURIComponent(id)}`),
  putRide: (ride: RideRecord) =>
    request<{ ride: RideRecord }>('PUT', `/rides/${encodeURIComponent(ride.id)}`, ride),
  deleteRide: (id: string) => request<void>('DELETE', `/rides/${encodeURIComponent(id)}`),
  // 批量导入可能一次带上几百条含轨迹的记录，给它更长的超时
  bulkRides: (rides: RideRecord[]) =>
    request<BulkResult>('POST', '/rides/bulk', { rides }, { timeoutMs: 120_000 }),

  listBikes: () => request<{ items: Bike[] }>('GET', '/bikes'),
  putBike: (bike: Bike) => request<{ bike: Bike }>('PUT', `/bikes/${encodeURIComponent(bike.id)}`, bike),
  deleteBike: (id: string) => request<void>('DELETE', `/bikes/${encodeURIComponent(id)}`),
  bulkBikes: (bikes: Bike[]) =>
    request<BulkResult>('POST', '/bikes/bulk', { bikes }, { timeoutMs: 120_000 }),

  listDays: () => request<{ items: DayCheckIn[] }>('GET', '/days'),
  putDay: (day: DayCheckIn) => request<{ day: DayCheckIn }>('PUT', `/days/${encodeURIComponent(day.id)}`, day),
  deleteDay: (id: string) => request<void>('DELETE', `/days/${encodeURIComponent(id)}`),
  bulkDays: (days: DayCheckIn[]) =>
    request<BulkResult>('POST', '/days/bulk', { days }, { timeoutMs: 120_000 }),

  /* 用户端留言（单向，默认关闭，由站长在后台开启） */
  listFeedback: () => request<{ items: FeedbackItem[] }>('GET', '/feedback'),
  submitFeedback: (content: string) => request<{ feedback: FeedbackItem }>('POST', '/feedback', { content }),
}

/* ==================== 站长控制台 ==================== */

export interface AdminSetting {
  key: 'allow_register' | 'feedback_enabled' | 'invite_required'
  value: boolean
  /** 是否被后台改过；没改过时显示的是服务器 .env 里的值 */
  overridden: boolean
}

export interface AdminUser {
  id: number
  email: string
  displayName: string | null
  status: 'active' | 'disabled'
  createdAt: string
  lastLoginAt: string | null
  rideCount: number
  bikeCount: number
  dayCount: number
}

export interface AdminUserDetail {
  user: AdminUser & {
    isAdmin: boolean
    counts: { rides: number; bikes: number; days: number; feedback: number }
  }
  recentRides: AdminRide[]
}

/** 后台看到的记录：比用户端多一个归属账号 */
export type AdminRide = RideListItem & { userId: number; userEmail: string }

export interface AuditRow {
  id: number
  actorId: number
  action: string
  target: string | null
  detail: string | null
  ip: string | null
  createdAt: string
}

export interface BackupFile {
  name: string
  sizeKb: number
  createdAt: string
}

export interface AdminOverview {
  users: { total: number; disabled: number; registeredLast7d: number }
  rides: { total: number; last7d: number }
  bikes: number
  days: number
  feedback: { open: number }
  invites: number
  storage: {
    dbSizeKb: number
    walSizeKb: number
    backup: { dir: string; count: number; totalKb: number; keepDays: number }
  }
  server: { nodeVersion: string; platform: string; uptimeSec: number; rssMb: number; isProduction: boolean }
  settings: AdminSetting[]
  recentUsers: AdminUser[]
  recentAudit: AuditRow[]
}

export interface AdminStats {
  total: number
  withTrack: number
  avgDistanceKm: number | null
  byCity: { city: string; count: number }[]
  byMonth: { month: string; count: number }[]
  users: { total: number; disabled: number; registeredLast7d: number }
}

export interface DbStatus {
  integrity: string
  tables: { table: string; rows: number }[]
}

export interface InviteCode {
  code: string
  maxUses: number
  usedCount: number
  expiresAt: string | null
  note: string | null
  createdAt: string
  uses: { userId: number; email: string; usedAt: string }[]
}

export interface AdminFeedbackItem extends FeedbackItem {
  userEmail: string
}

export interface LogResult {
  configured: boolean
  file: string | null
  lines: string[]
  hint?: string
}

export interface EnvItem {
  key: string
  configured: boolean
  secret: boolean
}

/**
 * 站长控制台接口。
 * 后端每一条都要求管理员权限，普通账号请求会拿到 403 ——
 * 前端这里不做任何"假设有权限"的乐观处理，失败了就如实显示。
 */
export const adminApi = {
  overview: () => request<AdminOverview>('GET', '/admin/overview'),

  users: (params: { limit?: number; offset?: number; search?: string; sort?: string } = {}) =>
    request<{ items: AdminUser[]; total: number }>('GET', buildQuery('/admin/users', params)),
  user: (id: number) => request<AdminUserDetail>('GET', `/admin/users/${id}`),
  setUserStatus: (id: number, status: 'active' | 'disabled') =>
    request<{ id: number; email: string; status: string }>('PATCH', `/admin/users/${id}`, { status }),
  /** 不传 password 就让后端生成随机临时密码；明文只在响应里出现这一次 */
  resetUserPassword: (id: number, password?: string) =>
    request<{ password: string; generated: boolean }>('POST', `/admin/users/${id}/password`, password ? { password } : {}),
  deleteUser: (id: number, confirm: string) =>
    request<{ ok: boolean }>('DELETE', `/admin/users/${id}`, { confirm }),

  settings: () => request<{ items: AdminSetting[] }>('GET', '/admin/settings'),
  updateSetting: (key: string, value: boolean) =>
    request<{ items: AdminSetting[] }>('PATCH', '/admin/settings', { key, value }),

  rides: (params: { limit?: number; offset?: number; userId?: number; from?: string; to?: string; city?: string } = {}) =>
    request<{ items: AdminRide[]; total: number }>('GET', buildQuery('/admin/rides', params)),
  ride: (userId: number, id: string) =>
    request<{ ride: RideRecord }>('GET', `/admin/rides/${userId}/${encodeURIComponent(id)}`),
  deleteRide: (userId: number, id: string) =>
    request<{ ok: boolean }>('DELETE', `/admin/rides/${userId}/${encodeURIComponent(id)}`),
  stats: () => request<AdminStats>('GET', '/admin/stats'),

  backups: () =>
    request<{ info: { dir: string; count: number; totalKb: number; keepDays: number }; items: BackupFile[] }>(
      'GET',
      '/admin/backups'
    ),
  createBackup: () => request<{ item: BackupFile; removed: number }>('POST', '/admin/backups', {}),
  deleteBackup: (name: string) => request<{ ok: boolean }>('DELETE', `/admin/backups/${encodeURIComponent(name)}`),
  dbStatus: () => request<DbStatus>('GET', '/admin/db-status'),

  audit: (params: { limit?: number; offset?: number; action?: string } = {}) =>
    request<{ items: AuditRow[]; total: number }>('GET', buildQuery('/admin/audit', params)),
  pruneAudit: () => request<{ removed: number }>('POST', '/admin/audit/prune', {}),

  feedback: (params: { limit?: number; offset?: number; status?: string } = {}) =>
    request<{ items: AdminFeedbackItem[]; total: number }>('GET', buildQuery('/admin/feedback', params)),
  replyFeedback: (id: number, reply: string) =>
    request<{ ok: boolean }>('POST', `/admin/feedback/${id}/reply`, { reply }),
  setFeedbackStatus: (id: number, status: 'open' | 'done') =>
    request<{ ok: boolean }>('PATCH', `/admin/feedback/${id}`, { status }),

  invites: () => request<{ items: InviteCode[] }>('GET', '/admin/invites'),
  createInvite: (payload: { code?: string; maxUses?: number; expiresAt?: string; note?: string }) =>
    request<{ item: InviteCode }>('POST', '/admin/invites', payload),
  deleteInvite: (code: string) => request<{ ok: boolean }>('DELETE', `/admin/invites/${encodeURIComponent(code)}`),

  logs: (lines = 200) => request<LogResult>('GET', buildQuery('/admin/logs', { lines })),
  env: () => request<{ items: EnvItem[] }>('GET', '/admin/env'),
}
