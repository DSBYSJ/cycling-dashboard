import process from 'node:process'
import { loadConfig } from './config.ts'
import { openDatabase } from './db/index.ts'
import { buildApp } from './app.ts'

/**
 * 后端入口。启动顺序:读配置 → 开库并迁移 → 起 HTTP 服务。
 * 任何一步失败都直接退出并打印原因，不做"带病启动" —— 半瘫的服务比明着挂掉更难查。
 */

const config = loadConfig()
const db = await openDatabase(config.databasePath)
const app = await buildApp(config, db)

try {
  await app.listen({ port: config.port, host: config.host })
  app.log.info(`数据库：${config.databasePath}`)
  app.log.info(`注册入口：${config.allowRegister ? '开放' : '已关闭'}`)
  if (config.usingEphemeralSecret) {
    app.log.warn('JWT_SECRET 使用的是临时密钥，重启后所有人需要重新登录。上线前请执行 npm run gen-secret 并写入 .env')
  }
  if (!config.cookieSecure) {
    app.log.warn('COOKIE_SECURE=false：登录 Cookie 不要求 HTTPS。仅在你还没配好证书时临时使用')
  }
} catch (err) {
  app.log.error(err, '启动失败')
  db.close()
  process.exit(1)
}

/** 优雅退出:PM2 reload / 宝塔重启时先停止收新请求，再关闭数据库 */
let closing = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (closing) return
    closing = true
    app.log.info(`收到 ${signal}，正在关闭…`)
    void app
      .close()
      .then(() => {
        db.close()
        process.exit(0)
      })
      .catch(() => process.exit(1))
  })
}
