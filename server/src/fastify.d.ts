import type { SessionPayload } from './auth/token.ts'

/**
 * 给 Fastify 的请求对象加上当前登录用户。
 * 纯类型声明，运行时不会有任何代码(类型剥离后本文件为空)。
 */
declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionPayload
  }
}
