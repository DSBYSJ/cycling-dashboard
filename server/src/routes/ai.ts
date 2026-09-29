import type { FastifyPluginAsync } from 'fastify'
import type { AppConfig } from '../config.ts'
import type { Database } from '../db/index.ts'
import { AppError, badRequest, notFound } from '../lib/errors.ts'
import { makeAdminHook } from '../lib/http.ts'
import { getRide, listRides } from '../repos/rides.ts'
import type { AiConfig } from '../ai/deepseek.ts'
import { buildRideFacts } from '../ai/prompt.ts'
import { coachCacheKey, generateCoachReview } from '../ai/coach.ts'
import { aiCallStats, recentAiCalls } from '../ai/metrics.ts'

/**
 * AI 骑行教练接口。
 *
 * ⚠️ 整块只对**管理员（站长本人）**开放，这是刻意的合规约束而不是偷懒：
 * 个人主体 ICP 备案不能面向公众提供生成式 AI 服务（需完成大模型服务登记，
 * 而该登记的主体必须是境内法人，自然人不能申报）。
 * 把这条限制写在权限钩子里，比写在文档里可靠 —— 代码不会忘记。
 *
 * 模型调用一律由后端代理：API Key 若下发到前端，等于公开。
 */

/** 历史对比的取数条数（含当前这条，实际用 5 条对比） */
const HISTORY_FETCH = 6

function toAiConfig(config: AppConfig): AiConfig {
  return {
    apiKey: config.deepseekApiKey,
    baseUrl: config.deepseekBaseUrl,
    model: config.deepseekModel,
    timeoutMs: config.deepseekTimeoutMs,
  }
}

export function aiRoutes(db: Database, config: AppConfig): FastifyPluginAsync {
  return async (app) => {
    const requireAdmin = makeAdminHook(config, db)
    const available = (): boolean => config.aiCoachEnabled && config.deepseekApiKey !== null

    /**
     * 功能状态。前端据此决定是否渲染「AI 复盘」入口 ——
     * 没配 Key 时整块隐藏，而不是给用户一个点了报错的按钮。
     */
    app.get('/status', { preHandler: requireAdmin }, async () => ({
      available: available(),
      model: available() ? config.deepseekModel : null,
      stats: aiCallStats(),
    }))

    /**
     * 生成某条记录的复盘。
     *
     * 返回值里同时带上记录里**已有的规则建议**（comment / suggestions），
     * 这样降级时前端不需要再请求一次 —— 兜底内容本来就在库里。
     */
    app.post(
      '/coach',
      {
        preHandler: requireAdmin,
        // AI 调用有真金白银的成本，给一个比全局更严的独立阈值
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      },
      async (request) => {
        if (!available()) {
          throw new AppError(503, 'ai_disabled', 'AI 骑行教练未启用')
        }

        const body = (request.body ?? {}) as Record<string, unknown>
        const rideId = typeof body.rideId === 'string' ? body.rideId.trim() : ''
        if (rideId === '') throw badRequest('缺少 rideId')

        const userId = request.user!.userId
        const ride = getRide(db, userId, rideId)
        if (!ride) throw notFound('骑行记录不存在')

        // 取最近几条做历史对比；同一条记录本身要排除掉
        const recent = listRides(db, userId, { limit: HISTORY_FETCH, offset: 0 }).items.filter(
          (item) => item.id !== rideId
        )

        const facts = buildRideFacts(ride, recent)
        const outcome = await generateCoachReview(toAiConfig(config), facts, coachCacheKey(ride.id, ride.updatedAt))

        return {
          ...outcome,
          model: config.deepseekModel,
          fallback: {
            comment: ride.comment ?? '',
            suggestions: Array.isArray(ride.suggestions) ? ride.suggestions : [],
          },
        }
      }
    )

    /** 调用记录（站长排查用）：模型是超时、限流，还是返回格式不对 */
    app.get('/calls', { preHandler: requireAdmin }, async () => ({
      stats: aiCallStats(),
      items: recentAiCalls(),
    }))
  }
}
