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
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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
    request<{ user: PublicUser }>('POST', '/auth/register', { email, password }),
  login: (email: string, password: string) =>
    request<{ user: PublicUser }>('POST', '/auth/login', { email, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  me: () => request<{ user: PublicUser }>('GET', '/auth/me'),
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
}
