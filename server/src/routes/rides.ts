import type { FastifyPluginAsync } from 'fastify'
import type { RideRecord } from '../../../src/types.ts'
import type { AppConfig } from '../config.ts'
import type { Database } from '../db/index.ts'
import { badRequest, notFound } from '../lib/errors.ts'
import { makeAuthHook } from '../lib/http.ts'
import { parsePagination, validateRide } from '../lib/validate.ts'
import { deleteRide, getRide, listRides, upsertRide, upsertRides } from '../repos/rides.ts'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** 单次批量导入的条数上限，避免一个请求把内存打满 */
const BULK_LIMIT = 5_000

export function rideRoutes(db: Database, config: AppConfig): FastifyPluginAsync {
  return async (app) => {
    const requireAuth = makeAuthHook(config, db)

    /** 列表:分页 + 可选日期区间;不含体积最大的轨迹字段 */
    app.get('/', { preHandler: requireAuth }, async (request) => {
      const query = (request.query ?? {}) as Record<string, unknown>
      const { limit, offset } = parsePagination(query)
      const from = typeof query.from === 'string' && DATE_RE.test(query.from) ? query.from : undefined
      const to = typeof query.to === 'string' && DATE_RE.test(query.to) ? query.to : undefined

      const { items, total } = listRides(db, request.user!.userId, { limit, offset, from, to })
      return { items, total, limit, offset }
    })

    /** 详情:含完整轨迹，前端在看地图/海拔曲线时按需取 */
    app.get('/:id', { preHandler: requireAuth }, async (request) => {
      const { id } = request.params as { id: string }
      const ride = getRide(db, request.user!.userId, id)
      if (!ride) throw notFound('骑行记录不存在')
      return { ride }
    })

    /** 新增或覆盖一条记录(路径参数为准，请求体里的 id 不一致直接拒绝) */
    app.put('/:id', { preHandler: requireAuth }, async (request) => {
      const { id } = request.params as { id: string }
      const body = request.body
      if (body !== null && typeof body === 'object' && 'id' in body) {
        const bodyId = (body as { id?: unknown }).id
        if (typeof bodyId === 'string' && bodyId !== id) {
          throw badRequest('请求体里的 id 与地址栏不一致')
        }
      }
      const ride = validateRide({ ...(typeof body === 'object' && body !== null ? body : {}), id })
      upsertRide(db, request.user!.userId, ride as RideRecord)
      return { ride }
    })

    app.delete('/:id', { preHandler: requireAuth }, async (request, reply) => {
      const { id } = request.params as { id: string }
      if (!deleteRide(db, request.user!.userId, id)) throw notFound('骑行记录不存在')
      reply.code(204)
      return null
    })

    /**
     * 批量导入:用于「把浏览器里已有的本地数据搬到云端」。
     * 单条格式错误只跳过并计数，不整批失败 —— 几十条历史记录里有一条脏数据，
     * 不该让用户完全无法迁移(前端会明确告知跳过了几条)。
     */
    app.post('/bulk', { preHandler: requireAuth }, async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>
      if (!Array.isArray(body.rides)) throw badRequest('rides 必须是数组')
      const raw = body.rides as unknown[]
      if (raw.length > BULK_LIMIT) throw badRequest(`一次最多导入 ${BULK_LIMIT} 条记录`)

      const valid: RideRecord[] = []
      let skipped = 0
      for (const item of raw) {
        try {
          valid.push(validateRide(item) as RideRecord)
        } catch {
          skipped += 1
        }
      }
      const imported = upsertRides(db, request.user!.userId, valid)
      reply.code(201)
      return { imported, skipped }
    })
  }
}
