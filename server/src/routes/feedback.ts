import type { FastifyPluginAsync } from 'fastify'
import { isAdminSession, type AppConfig } from '../config.ts'
import type { Database } from '../db/index.ts'
import { AppError, badRequest } from '../lib/errors.ts'
import { makeAuthHook } from '../lib/http.ts'
import { getBoolSetting } from '../lib/settings.ts'
import {
  MAX_OPEN_FEEDBACK_PER_USER,
  countOpenFeedbackByUser,
  createFeedback,
  listFeedbackByUser,
} from '../repos/feedback.ts'

const MAX_CONTENT = 2000

/**
 * 用户 → 站长的单向留言。
 *
 * 严格单向、不公开：用户只能看到自己提交的与站长的回复，看不到别人的 ——
 * 因此它不构成"用户间信息发布"，合规上只相当于意见反馈。
 * 详见 docs/用户聊天功能合规评估.md
 *
 * 开放状态由运行时设置 feedback_enabled 控制(默认关闭)。
 * **管理员始终可用** —— 站长要先把功能自己跑通，再决定对外开不开。
 */
export function feedbackRoutes(db: Database, config: AppConfig): FastifyPluginAsync {
  return async (app) => {
    const requireAuth = makeAuthHook(config, db)

    const enabledFor = (session: { userId: number; email: string }): boolean =>
      getBoolSetting(db, 'feedback_enabled', false) || isAdminSession(config, session)

    function assertEnabled(session: { userId: number; email: string }): void {
      if (!enabledFor(session)) {
        throw new AppError(403, 'feedback_disabled', '留言功能暂未开放')
      }
    }

    /** 看看能不能用 + 自己提交过的留言(含站长的回复) */
    app.get('/', { preHandler: requireAuth }, async (request) => {
      assertEnabled(request.user!)
      return { items: listFeedbackByUser(db, request.user!.userId) }
    })

    app.post(
      '/',
      {
        preHandler: requireAuth,
        config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
        handler: async (request, reply) => {
          assertEnabled(request.user!)
          const body = (request.body ?? {}) as Record<string, unknown>
          const content = typeof body.content === 'string' ? body.content.trim() : ''
          if (!content) throw badRequest('请填写留言内容')
          if (content.length > MAX_CONTENT) throw badRequest(`留言最多 ${MAX_CONTENT} 字`)

          // 防止有人刷爆后台：未处理的留言攒够就先等等
          if (countOpenFeedbackByUser(db, request.user!.userId) >= MAX_OPEN_FEEDBACK_PER_USER) {
            throw badRequest('你还有未处理的留言，等站长处理后再提交吧')
          }

          reply.code(201)
          return { feedback: createFeedback(db, request.user!.userId, content) }
        },
      }
    )
  }
}
