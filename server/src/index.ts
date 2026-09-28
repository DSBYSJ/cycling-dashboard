import process from 'node:process'
import { loadConfig, warnIfNoAdmin } from './config.ts'
import { openDatabase } from './db/index.ts'
import { getBoolSetting } from './lib/settings.ts'
import { buildApp } from './app.ts'

/**
 * 后端入口。启动顺序:读配置 → 开库并迁移 → 起 HTTP 服务。
 * 任何一步失败都直接退出并打印原因，不做"带病启动" —— 半瘫的服务比明着挂掉更难查。
 */

const config = loadConfig()
warnIfNoAdmin(config)
const db = await openDatabase(config.databasePath)
const app = await buildApp(config, db)

try {
  await app.listen({ port: config.port, host: config.host })
  // 注册开关以数据库里的运行时设置为准(后台可一键切换)，没设置过才回落到 .env
  const allowRegister = getBoolSetting(db, 'allow_register', config.allowRegister)
  app.log.info(`数据库：${config.databasePath}`)
  app.log.info(`注册入口：${allowRegister ? '开放' : '已关闭'}`)
  app.log.info(`备份目录：${config.backupDir}`)
  if (config.adminUserIds.length > 0 || config.adminAccounts.length > 0) {
    app.log.info(
      `管理员：${[...config.adminUserIds.map((id) => `#${id}`), ...config.adminAccounts].join(', ')}`
    )
  }
  if (config.usingEphemeralSecret) {
    app.log.warn('JWT_SECRET 使用的是临时密钥，重启后所有人需要重新登录。上线前请执行 npm run gen-secret 并写入 .env')
  }
  if (!config.cookieSecure) {
    app.log.warn('COOKIE_SECURE=false：登录 Cookie 不要求 HTTPS。仅在你还没配好证书时临时使用')
  }
  if (!config.logFile) {
    app.log.info('未配置 LOG_FILE，站长控制台的「日志」页将不可用（可到宝塔面板查看）')
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
