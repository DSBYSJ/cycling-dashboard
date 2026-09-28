import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { isAdminSession, type AppConfig } from '../config.ts'
import type { Database } from '../db/index.ts'
import { findUserById } from '../repos/users.ts'
import { AppError, forbidden, unauthorized } from './errors.ts'
import { verifySession } from '../auth/token.ts'

export const SESSION_COOKIE = 'cd_session'

/**
 * 会话放在 httpOnly Cookie 里，而不是 localStorage:
 * - JS 读不到，XSS 拿不走登录态
 * - 前端不需要自己管令牌，也不用担心忘记加 Authorization 头
 * 代价是依赖 Cookie 自动携带，所以必须同源部署(Nginx 把 /api 反代到 Node),
 * 否则要处理 CORS + SameSite，反而更容易配错。
 */
export function setSessionCookie(reply: FastifyReply, token: string, config: AppConfig): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    maxAge: config.sessionDays * 24 * 60 * 60,
  })
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}

/**
 * 认证钩子:有合法会话就挂到 request.user，否则 401。
 *
 * 每次请求都回查一次账号状态，这是刻意的 —— 只看 JWT 的话，站长停用某个账号后，
 * 对方手里的 Cookie 仍能继续用满整个有效期，那样"停用"就形同虚设。
 * 顺带比对令牌版本，让改密 / 重置密码也能立即把旧令牌踢下线。
 * SQLite 本地查询是微秒级，这点开销换得来。
 */
export function makeAuthHook(config: AppConfig, db: Database) {
  return async function requireAuth(request: FastifyRequest): Promise<void> {
    const token = request.cookies?.[SESSION_COOKIE]
    if (!token) throw unauthorized()
    const session = verifySession(token, config.jwtSecret)
    if (!session) throw unauthorized('登录已过期，请重新登录', 'session_expired')

    const user = findUserById(db, session.userId)
    if (!user) throw unauthorized('账号不存在或已被删除')
    if (user.status === 'disabled') {
      throw new AppError(403, 'account_disabled', '账号已被停用，请联系管理员')
    }
    if (user.token_version !== session.tokenVersion) {
      throw unauthorized('登录状态已失效，请重新登录', 'session_expired')
    }

    request.user = session
  }
}

/**
 * 管理员钩子:先认证，再判是不是管理员。
 *
 * 权限必须在后端判 —— 前端"把入口藏起来"只是体验，不是权限控制。
 * 白名单来自 .env(adminUserIds / adminAccounts)，而会话里本来就带 userId 与 email，
 * 所以这里不用查库，也就不存在"数据库被改一下就能提权"的路径。
 */
export function makeAdminHook(config: AppConfig, db: Database) {
  const requireAuth = makeAuthHook(config, db)
  return async function requireAdmin(request: FastifyRequest): Promise<void> {
    await requireAuth(request)
    const session = request.user
    if (!session || !isAdminSession(config, session)) {
      throw forbidden('需要管理员权限')
    }
  }
}

/** 统一错误处理:业务错误返回结构化信息，未预期的错误只回一句通用提示并记日志 */
export function registerErrorHandler(app: FastifyInstance, config: AppConfig): void {
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: { code: 'not_found', message: `接口不存在：${request.method} ${request.url}` } })
  })

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } })
      return
    }

    // Fastify 自身抛出的校验类错误(JSON 解析失败、请求体过大等)
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500
    if (statusCode === 400) {
      reply.code(400).send({ error: { code: 'invalid_request', message: '请求格式不正确' } })
      return
    }
    if (statusCode === 413) {
      reply.code(413).send({ error: { code: 'payload_too_large', message: '数据太大了，请减少轨迹点后重试' } })
      return
    }
    if (statusCode === 429) {
      reply.code(429).send({ error: { code: 'rate_limited', message: '操作过于频繁，请稍后再试' } })
      return
    }

    request.log.error({ err: error }, '未处理的错误')
    reply.code(500).send({
      error: {
        code: 'internal_error',
        // 生产环境绝不外泄堆栈与内部信息；开发环境带上原始信息便于自查
        message: config.isProduction ? '服务器内部错误，请稍后重试' : `内部错误：${error.message}`,
      },
    })
  })
}
