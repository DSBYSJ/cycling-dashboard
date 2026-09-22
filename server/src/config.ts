import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export interface AppConfig {
  port: number
  host: string
  /** SQLite 文件路径;测试里用 ':memory:' */
  databasePath: string
  jwtSecret: string
  sessionDays: number
  cookieSecure: boolean
  allowRegister: boolean
  trustProxy: number
  /** 登录/注册接口的限流阈值(同一 IP 在时间窗内的最大次数),防密码爆破 */
  authRateLimitMax: number
  isProduction: boolean
  /** JWT_SECRET 是否用了临时随机值(重启后登录态失效) */
  usingEphemeralSecret: boolean
}

const PLACEHOLDER_SECRET = '请用-npm-run-gen-secret-生成一个随机值替换这里'

/** 读取 .env(Node 22 内置 process.loadEnvFile,不需要 dotenv) */
export function loadEnvFile(dir: string): void {
  const file = path.join(dir, '.env')
  if (!fs.existsSync(file)) return
  try {
    process.loadEnvFile(file)
  } catch (err) {
    throw new Error(`读取 .env 失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback
  return value === 'true' || value === '1'
}

/**
 * 组装配置。
 * 关键设计:JWT_SECRET 是登录态的根 —— 生产环境没有配置就直接启动失败,
 * 避免"忘了改密钥"悄悄上线;开发环境允许用一次性随机值,但会明确警告(重启后需要重新登录)。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, rootDir = process.cwd()): AppConfig {
  loadEnvFile(rootDir)

  const isProduction = env.NODE_ENV === 'production'
  const rawSecret = env.JWT_SECRET?.trim() ?? ''
  const secretMissing = rawSecret === '' || rawSecret === PLACEHOLDER_SECRET

  if (secretMissing && isProduction) {
    throw new Error(
      'JWT_SECRET 未配置(或仍是模板里的占位符)。请在 .env 里设置一个随机密钥，' +
        '生成方式：npm run gen-secret'
    )
  }
  if (!secretMissing && rawSecret.length < 32) {
    throw new Error('JWT_SECRET 太短(至少 32 个字符)，请用 npm run gen-secret 重新生成')
  }

  const jwtSecret = secretMissing ? crypto.randomBytes(48).toString('base64url') : rawSecret
  if (secretMissing && !isProduction) {
    console.warn('[配置] 未设置 JWT_SECRET，已生成临时密钥：进程重启后所有登录态失效。上线前务必执行 npm run gen-secret')
  }

  // ':memory:' 原样透传(测试用);其余按相对 server/ 目录解析成绝对路径，避免受启动目录影响
  const rawDbPath = env.DATABASE_PATH?.trim() || './data/cycling.db'
  const databasePath = rawDbPath === ':memory:' ? rawDbPath : path.resolve(rootDir, rawDbPath)

  return {
    port: num(env.PORT, 3000),
    host: env.HOST?.trim() || '127.0.0.1',
    databasePath,
    jwtSecret,
    sessionDays: Math.max(1, num(env.SESSION_DAYS, 30)),
    cookieSecure: bool(env.COOKIE_SECURE, isProduction),
    allowRegister: bool(env.ALLOW_REGISTER, true),
    trustProxy: num(env.TRUST_PROXY, 1),
    authRateLimitMax: Math.max(1, num(env.AUTH_RATE_LIMIT_MAX, 10)),
    isProduction,
    usingEphemeralSecret: secretMissing,
  }
}
