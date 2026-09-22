import type { FastifyPluginAsync } from 'fastify'
import type { DayCheckIn } from '../../../src/types.ts'
import type { AppConfig } from '../config.ts'
import type { Database } from '../db/index.ts'
import { badRequest, notFound } from '../lib/errors.ts'
import { makeAuthHook } from '../lib/http.ts'
import { validateDay } from '../lib/validate.ts'
import { deleteDay, listDays, upsertDay, upsertDays } from '../repos/days.ts'

const BULK_LIMIT = 3_000

export function dayRoutes(db: Database, config: AppConfig): FastifyPluginAsync {
  return async (app) => {
    const requireAuth = makeAuthHook(config)

    app.get('/', { preHandler: requireAuth }, async (request) => {
      return { items: listDays(db, request.user!.userId) }
    })

    app.put('/:id', { preHandler: requireAuth }, async (request) => {
      const { id } = request.params as { id: string }
      const body = request.body
      if (body !== null && typeof body === 'object' && 'id' in body) {
        const bodyId = (body as { id?: unknown }).id
        if (typeof bodyId === 'string' && bodyId !== id) throw badRequest('请求体里的 id 与地址栏不一致')
      }
      const day = validateDay({ ...(typeof body === 'object' && body !== null ? body : {}), id })
      upsertDay(db, request.user!.userId, day)
      return { day }
    })

    app.delete('/:id', { preHandler: requireAuth }, async (request, reply) => {
      const { id } = request.params as { id: string }
      if (!deleteDay(db, request.user!.userId, id)) throw notFound('打卡记录不存在')
      reply.code(204)
      return null
    })

    app.post('/bulk', { preHandler: requireAuth }, async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>
      if (!Array.isArray(body.days)) throw badRequest('days 必须是数组')
      const raw = body.days as unknown[]
      if (raw.length > BULK_LIMIT) throw badRequest(`一次最多导入 ${BULK_LIMIT} 条打卡`)

      const valid: DayCheckIn[] = []
      let skipped = 0
      for (const item of raw) {
        try {
          valid.push(validateDay(item))
        } catch {
          skipped += 1
        }
      }
      const imported = upsertDays(db, request.user!.userId, valid)
      reply.code(201)
      return { imported, skipped }
    })
  }
}
