import type { FastifyPluginAsync } from 'fastify'
import type { Bike } from '../../../src/types.ts'
import type { AppConfig } from '../config.ts'
import type { Database } from '../db/index.ts'
import { badRequest, notFound } from '../lib/errors.ts'
import { makeAuthHook } from '../lib/http.ts'
import { validateBike } from '../lib/validate.ts'
import { deleteBike, listBikes, upsertBike, upsertBikes } from '../repos/bikes.ts'

const BULK_LIMIT = 200

export function bikeRoutes(db: Database, config: AppConfig): FastifyPluginAsync {
  return async (app) => {
    const requireAuth = makeAuthHook(config, db)

    app.get('/', { preHandler: requireAuth }, async (request) => {
      return { items: listBikes(db, request.user!.userId) }
    })

    app.put('/:id', { preHandler: requireAuth }, async (request) => {
      const { id } = request.params as { id: string }
      const body = request.body
      if (body !== null && typeof body === 'object' && 'id' in body) {
        const bodyId = (body as { id?: unknown }).id
        if (typeof bodyId === 'string' && bodyId !== id) throw badRequest('请求体里的 id 与地址栏不一致')
      }
      const bike = validateBike({ ...(typeof body === 'object' && body !== null ? body : {}), id })
      upsertBike(db, request.user!.userId, bike)
      return { bike }
    })

    app.delete('/:id', { preHandler: requireAuth }, async (request, reply) => {
      const { id } = request.params as { id: string }
      if (!deleteBike(db, request.user!.userId, id)) throw notFound('单车不存在')
      reply.code(204)
      return null
    })

    app.post('/bulk', { preHandler: requireAuth }, async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>
      if (!Array.isArray(body.bikes)) throw badRequest('bikes 必须是数组')
      const raw = body.bikes as unknown[]
      if (raw.length > BULK_LIMIT) throw badRequest(`一次最多导入 ${BULK_LIMIT} 辆车`)

      const valid: Bike[] = []
      let skipped = 0
      for (const item of raw) {
        try {
          valid.push(validateBike(item))
        } catch {
          skipped += 1
        }
      }
      const imported = upsertBikes(db, request.user!.userId, valid)
      reply.code(201)
      return { imported, skipped }
    })
  }
}
