import crypto from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { isAdminSession, type AppConfig } from '../config.ts'
import type { Database } from '../db/index.ts'
import { AppError, unauthorized } from '../lib/errors.ts'
import { clearSessionCookie, makeAuthHook, setSessionCookie } from '../lib/http.ts'
import { getBoolSetting } from '../lib/settings.ts'
import { normalizeAccount, validatePassword } from '../lib/validate.ts'
import { hashPassword, verifyPassword } from './password.ts'
import { signSession } from './token.ts'
import { consumeInviteCode, peekInviteCode } from '../repos/invite.ts'
import {
  createUser,
  deleteUser,
  findUserByEmail,
  findUserById,
  toPublicUser,
  touchLastLogin,
  updateUserPassword,
  type UserRow,
} from '../repos/users.ts'

/** 用于「用户不存在」时消耗等量 CPU，避免通过响应时间判断账号是否注册过 */
let dummyHashPromise: Promise<string> | null = null
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(crypto.randomBytes(16).toString('hex'))
  return dummyHashPromise
}

/**
 * 登录 / 注册 / 查询当前用户返回同一套信息。
 * 抽出来是为了三处字段永远一致 —— 前端只认这一个形状。
 */
function sessionInfo(db: Database, config: AppConfig, user: UserRow) {
  return {
    user: toPublicUser(user),
    /** 仅用于决定要不要显示「站长控制台」入口；权限在后端判 */
    isAdmin: isAdminSession(config, { userId: user.id, email: user.email }),
    /** 留言功能的开放状态（管理员始终可用，便于先自己测） */
    feedbackEnabled: getBoolSetting(db, 'feedback_enabled', false),
  }
}

export function authRoutes(db: Database, config: AppConfig): FastifyPluginAsync {
  return async (app) => {
    const requireAuth = makeAuthHook(config, db)

    app.post('/register', {
      config: { rateLimit: { max: config.authRateLimitMax, timeWindow: '10 minutes' } },
      handler: async (request, reply) => {
        // 注册开关优先读数据库里的运行时设置(后台可一键切换)，没设置过才回落到 .env
        if (!getBoolSetting(db, 'allow_register', config.allowRegister)) {
          throw new AppError(403, 'register_disabled', '本站已关闭注册，请联系管理员开通账号')
        }

        const body = (request.body ?? {}) as Record<string, unknown>
        const email = normalizeAccount(body.email)
        const password = validatePassword(body.password)

        // 需要邀请码时，先检查有效性(真正核销放在账号创建成功之后)
        const inviteRequired = getBoolSetting(db, 'invite_required', false)
        const inviteCode = typeof body.inviteCode === 'string' ? body.inviteCode.trim() : ''
        if (inviteRequired) {
          if (!inviteCode) throw new AppError(403, 'invite_required', '本站需要邀请码才能注册')
          const check = peekInviteCode(db, inviteCode)
          if (!check.ok) throw new AppError(403, 'invite_invalid', check.reason)
        }

        if (findUserByEmail(db, email)) {
          throw new AppError(409, 'email_taken', '该账号已被注册，请直接登录')
        }

        const passwordHash = await hashPassword(password)
        let user: UserRow
        try {
          user = createUser(db, email, passwordHash)
        } catch (err) {
          // 并发注册同一账号时，唯一索引会拦下来
          if (String(err).includes('UNIQUE')) {
            throw new AppError(409, 'email_taken', '该账号已被注册，请直接登录')
          }
          throw err
        }

        if (inviteRequired && inviteCode) {
          const used = consumeInviteCode(db, inviteCode, user.id)
          if (!used.ok) {
            // 极端并发下名额被别人抢走：把刚建好的账号删掉，
            // 不能留下一个"没核销邀请码"的账号
            deleteUser(db, user.id)
            throw new AppError(403, 'invite_invalid', used.reason)
          }
        }

        const token = signSession(user.id, user.email, user.token_version, config.jwtSecret, config.sessionDays)
        setSessionCookie(reply, token, config)
        reply.code(201)
        return sessionInfo(db, config, user)
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
          throw unauthorized('账号或密码不正确', 'invalid_credentials')
        }
        const ok = await verifyPassword(password, user.password_hash)
        if (!ok) throw unauthorized('账号或密码不正确', 'invalid_credentials')

        // 认证钩子也会拦停用账号，但登录这一步单独挡一下能给出更清楚的提示
        if (user.status === 'disabled') {
          throw new AppError(403, 'account_disabled', '账号已被停用，请联系管理员')
        }

        touchLastLogin(db, user.id)
        const token = signSession(user.id, user.email, user.token_version, config.jwtSecret, config.sessionDays)
        setSessionCookie(reply, token, config)
        return sessionInfo(db, config, user)
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
      return sessionInfo(db, config, user)
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

      // 改密会自增令牌版本、让所有已签发的令牌作废 —— 所以给当前设备重新签发一个，
      // 否则用户会「刚改完自己的密码就被踢出去」。
      const fresh = findUserById(db, user.id)!
      setSessionCookie(
        reply,
        signSession(fresh.id, fresh.email, fresh.token_version, config.jwtSecret, config.sessionDays),
        config
      )
      reply.code(204)
      return null
    })
  }
}
