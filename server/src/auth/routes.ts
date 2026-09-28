import crypto from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { AppConfig } from '../config.ts'
import type { Database } from '../db/index.ts'
import { AppError, unauthorized } from '../lib/errors.ts'
import { clearSessionCookie, makeAuthHook, setSessionCookie } from '../lib/http.ts'
import { normalizeAccount, validatePassword } from '../lib/validate.ts'
import { hashPassword, verifyPassword } from './password.ts'
import { signSession } from './token.ts'
import { createUser, findUserByEmail, findUserById, toPublicUser, updateUserPassword } from '../repos/users.ts'

/** 用于「用户不存在」时消耗等量 CPU，避免通过响应时间判断邮箱是否注册过 */
let dummyHashPromise: Promise<string> | null = null
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(crypto.randomBytes(16).toString('hex'))
  return dummyHashPromise
}

export function authRoutes(db: Database, config: AppConfig): FastifyPluginAsync {
  return async (app) => {
    const requireAuth = makeAuthHook(config)

    app.post('/register', {
      config: { rateLimit: { max: config.authRateLimitMax, timeWindow: '10 minutes' } },
      handler: async (request, reply) => {
        if (!config.allowRegister) {
          throw new AppError(403, 'register_disabled', '本站已关闭注册，请联系管理员开通账号')
        }
        const body = (request.body ?? {}) as Record<string, unknown>
        const email = normalizeAccount(body.email)
        const password = validatePassword(body.password)

        if (findUserByEmail(db, email)) {
          throw new AppError(409, 'email_taken', '该邮箱已被注册，请直接登录')
        }

        const passwordHash = await hashPassword(password)
        let user
        try {
          user = createUser(db, email, passwordHash)
        } catch (err) {
          // 并发注册同一邮箱时，唯一索引会拦下来
          if (String(err).includes('UNIQUE')) {
            throw new AppError(409, 'email_taken', '该邮箱已被注册，请直接登录')
          }
          throw err
        }

        const token = signSession(user.id, user.email, config.jwtSecret, config.sessionDays)
        setSessionCookie(reply, token, config)
        reply.code(201)
        return { user: toPublicUser(user) }
      },
    })

    app.post('/login', {
      // 限流是这里最要紧的防线:没有它，密码可以被无限次暴力尝试
      config: { rateLimit: { max: config.authRateLimitMax, timeWindow: '10 minutes' } },
      handler: async (request, reply) => {
        const body = (request.body ?? {}) as Record<string, unknown>
        const email = normalizeAccount(body.email)
        const password = typeof body.password === 'string' ? body.password : ''

        const user = findUserByEmail(db, email)
        if (!user) {
          await verifyPassword(password, await dummyHash())
          throw unauthorized('邮箱或密码不正确', 'invalid_credentials')
        }
        const ok = await verifyPassword(password, user.password_hash)
        if (!ok) throw unauthorized('邮箱或密码不正确', 'invalid_credentials')

        const token = signSession(user.id, user.email, config.jwtSecret, config.sessionDays)
        setSessionCookie(reply, token, config)
        return { user: toPublicUser(user) }
      },
    })

    app.post('/logout', async (_request, reply) => {
      clearSessionCookie(reply)
      reply.code(204)
      return null
    })

    app.get('/me', { preHandler: requireAuth }, async (request) => {
      const user = findUserById(db, request.user!.userId)
      if (!user) throw unauthorized('账号不存在或已被删除')
      return { user: toPublicUser(user) }
    })

    app.post('/password', { preHandler: requireAuth }, async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>
      const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
      const newPassword = validatePassword(body.newPassword)

      const user = findUserById(db, request.user!.userId)
      if (!user) throw unauthorized('账号不存在或已被删除')
      if (!(await verifyPassword(currentPassword, user.password_hash))) {
        throw unauthorized('当前密码不正确', 'invalid_credentials')
      }

      await updateUserPassword(db, user.id, await hashPassword(newPassword))
      // 改密后旧令牌依然有效直到过期(自用场景可接受)；如需强制下线，可在此加入令牌版本号
      reply.code(204)
      return null
    })
  }
}
