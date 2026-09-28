import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError, api, apiUrl } from '../client'

/**
 * 这些用例守的是「前后端之间的约定」——错误码怎么解析、Cookie 有没有带上、
 * id 有没有被安全地拼进 URL。这些一旦出错，界面上的表现往往是莫名其妙的
 * 「操作失败」，很难追，所以用测试固定住。
 */

function fakeResponse(status: number, body?: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response
}

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init ?? {}))
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('API 客户端', () => {
  it('同源部署时请求 /api/... 路径', () => {
    expect(apiUrl('/health')).toBe('/api/health')
  })

  it('成功时返回解析后的 JSON', async () => {
    mockFetch(() => fakeResponse(200, { user: { id: 1, email: 'a@b.co' } }))
    const res = await api.me()
    expect(res.user.email).toBe('a@b.co')
  })

  it('每个请求都带 credentials=include —— 登录态在 httpOnly Cookie 里，漏了就永远登录不上', async () => {
    const spy = mockFetch(() => fakeResponse(200, { user: { id: 1 } }))
    await api.me()
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.credentials).toBe('include')
  })

  it('注册开关接口：路径为 /auth/config，且如实反映「已暂停」', async () => {
    // 登录页靠它决定入口显示「注册」还是「暂停注册」，路径写错会静默退回「注册」
    const spy = mockFetch(() => fakeResponse(200, { allowRegister: false, inviteRequired: false }))
    const cfg = await api.authConfig()
    expect(String(spy.mock.calls[0][0])).toBe('/api/auth/config')
    expect(cfg.allowRegister).toBe(false)
    expect(cfg.inviteRequired).toBe(false)
  })

  it('204（退出登录、改密码）返回 undefined，不尝试解析 JSON', async () => {
    mockFetch(() => fakeResponse(204))
    await expect(api.logout()).resolves.toBeUndefined()
  })

  it('把后端的 {error:{code,message}} 解析成 ApiError', async () => {
    mockFetch(() => fakeResponse(409, { error: { code: 'email_taken', message: '该邮箱已被注册' } }))
    await expect(api.register('a@b.co', 'password-123')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'email_taken',
      status: 409,
      message: '该邮箱已被注册',
    })
  })

  it('401 / session_expired 被识别为「需要重新登录」，其它错误码不会误判', async () => {
    mockFetch(() => fakeResponse(401, { error: { code: 'session_expired', message: '登录已过期' } }))
    const expired = await api.me().catch((e) => e)
    expect(expired).toBeInstanceOf(ApiError)
    expect((expired as ApiError).isAuthFailure).toBe(true)

    mockFetch(() => fakeResponse(409, { error: { code: 'email_taken', message: 'x' } }))
    const taken = await api.register('a@b.co', 'password-123').catch((e) => e)
    expect((taken as ApiError).isAuthFailure).toBe(false)
  })

  it('响应体不是预期的错误结构时，回落到 server_error 而不是崩掉', async () => {
    mockFetch(() => fakeResponse(500, 'Internal Server Error'))
    const err = await api.health().catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe('server_error')
  })

  it('fetch 本身失败（断网）抛 NetworkError，与业务错误区分开', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
    )
    await expect(api.health()).rejects.toBeInstanceOf(NetworkError)
  })

  it('调用方主动取消（AbortError）原样抛出，不伪装成网络故障', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('aborted', 'AbortError')
      })
    )
    const err = await api.health().catch((e) => e)
    expect(err).toBeInstanceOf(DOMException)
    expect((err as DOMException).name).toBe('AbortError')
  })

  it('id 会被 URL 编码，避免路径拼接被注入', async () => {
    const spy = mockFetch(() => fakeResponse(200, { ride: {} }))
    await api.getRide('a/../b?x=1')
    expect(spy.mock.calls[0][0]).toBe('/api/rides/a%2F..%2Fb%3Fx%3D1')
  })

  it('批量导入把记录包在 { rides: [...] } 里，并走 POST /rides/bulk', async () => {
    const spy = mockFetch(() => fakeResponse(201, { imported: 2, skipped: 0 }))
    const result = await api.bulkRides([{ id: 'r1' }, { id: 'r2' }] as never)
    expect(result).toEqual({ imported: 2, skipped: 0 })

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/rides/bulk')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ rides: [{ id: 'r1' }, { id: 'r2' }] })
  })

  it('列表查询参数会拼进 URL，undefined 的参数被忽略', async () => {
    const spy = mockFetch(() => fakeResponse(200, { items: [], total: 0, limit: 200, offset: 0 }))
    await api.listRides({ limit: 200, offset: 0 })
    expect(spy.mock.calls[0][0]).toBe('/api/rides?limit=200&offset=0')
  })
})
