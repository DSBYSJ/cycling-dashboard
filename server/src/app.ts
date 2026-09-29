import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import type { AppConfig } from './config.ts'
import type { Database } from './db/index.ts'
import { makeAuthHook, registerErrorHandler } from './lib/http.ts'
import { parsePagination } from './lib/validate.ts'
import { findUserById, toPublicUser } from './repos/users.ts'
import { unauthorized } from './lib/errors.ts'
import { authRoutes } from './auth/routes.ts'
import { rideRoutes } from './routes/rides.ts'
import { bikeRoutes } from './routes/bikes.ts'
import { dayRoutes } from './routes/days.ts'
import { adminRoutes } from './routes/admin.ts'
import { feedbackRoutes } from './routes/feedback.ts'
import { aiRoutes } from './routes/ai.ts'
import { listBikes } from './repos/bikes.ts'
import { listDays } from './repos/days.ts'
import { listRides } from './repos/rides.ts'

/**
 * 组装应用(不在这里 listen，方便测试用 app.inject() 直接发请求)。
 *
 * 路由分六块，前端一律走同源 /api：
 *   /api/auth/*     注册、登录、退出、当前用户
 *   /api/rides/*    骑行记录(列表不含轨迹，详情含)
 *   /api/bikes/*    单车
 *   /api/days/*     每日打卡
 *   /api/feedback/* 用户 → 站长的单向留言(默认关闭，可在后台开启)
 *   /api/ai/*       AI 骑行复盘(仅站长本人可用，且需配置 DEEPSEEK_API_KEY)
 *   /api/admin/*    站长控制台(整块都要求管理员权限)
 * 另有 /api/health(探活) 与 /api/bootstrap(首屏一次性拉取)。
 */
export async function buildApp(config: AppConfig, db: Database): Promise<FastifyInstance> {
  const app = Fastify({
    /* Fastify 的 trustProxy 不接受数字:这里映射成"只信任本机反向代理"。
       只写 true 会让任何人都能伪造 X-Forwarded-For 绕过限流，映射到 127.0.0.1 更稳妥。 */
    trustProxy: config.trustProxy > 0 ? '127.0.0.1' : false,
    // 一条带 2 万个轨迹点的记录约 1~2MB，留出余量
    bodyLimit: 8 * 1024 * 1024,
    logger: {
      level: config.isProduction ? 'info' : 'warn',
      // 日志里不打印 Cookie / Authorization，避免登录态被写进日志文件
      redact: ['req.headers.cookie', 'req.headers.authorization'],
    },
  })

  await app.register(cookie)
  await app.register(rateLimit, {
    // 全局兜底上限，防止有人拿脚本刷接口；登录/注册在路由里设更严的阈值
    max: 300,
    timeWindow: '1 minute',
    // 超限时用统一结构返回，前端能识别
    errorResponseBuilder: () => ({ error: { code: 'rate_limited', message: '操作过于频繁，请稍后再试' } }),
  })

  const requireAuth = makeAuthHook(config, db)

  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }))

  /** 首屏数据:一次拿齐单车、打卡与骑行记录列表，减少移动端往返次数 */
  app.get('/api/bootstrap', { preHandler: requireAuth }, async (request) => {
    const userId = request.user!.userId
    const user = findUserById(db, userId)
    if (!user) throw unauthorized('账号不存在或已被删除')

    const { limit, offset } = parsePagination(request.query)
    const rides = listRides(db, userId, { limit, offset })
    return {
      user: toPublicUser(user),
      bikes: listBikes(db, userId),
      days: listDays(db, userId),
      rides: { items: rides.items, total: rides.total, limit, offset },
    }
  })

  /* 错误处理器必须在注册路由之前设置:各路由模块是独立封装的插件，
     它们注册时会捕获当时的处理器，之后再设置对已注册的路由不生效。 */
  registerErrorHandler(app, config)

  await app.register(authRoutes(db, config), { prefix: '/api/auth' })
  await app.register(rideRoutes(db, config), { prefix: '/api/rides' })
  await app.register(bikeRoutes(db, config), { prefix: '/api/bikes' })
  await app.register(dayRoutes(db, config), { prefix: '/api/days' })
  await app.register(feedbackRoutes(db, config), { prefix: '/api/feedback' })
  await app.register(aiRoutes(db, config), { prefix: '/api/ai' })
  await app.register(adminRoutes(db, config), { prefix: '/api/admin' })

  return app
}
