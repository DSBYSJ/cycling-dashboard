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
  /**
   * 管理员白名单(账号 id)。故意放在 .env 而不是数据库:
   * 不动表结构、改配置即生效，而且数据库即使被改也提不了权 ——
   * 提权得同时拿下服务器文件系统，门槛高得多。
   */
  adminUserIds: number[]
  /** 管理员白名单(账号标识，已转小写)。与 adminUserIds 是"或"的关系，配哪个都行 */
  adminAccounts: string[]
  /** 备份目录(后台「备份管理」读写的就是这里) */
  backupDir: string
  /** 备份保留天数(与 scripts/backup.mjs 的 BACKUP_KEEP_DAYS 共用同一个值) */
  backupKeepDays: number
  /** 后端日志文件路径;未配置时后台不提供日志查看(可去宝塔面板看) */
  logFile: string | null
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

/** 逗号分隔 → 去空去重的字符串数组 */
function strList(value: string | undefined): string[] {
  if (!value) return []
  return [...new Set(value.split(',').map((s) => s.trim()).filter(Boolean))]
}

/** 逗号分隔 → 正整数数组(非法项直接丢弃，不让一个手滑的值把配置整个搞坏) */
function intList(value: string | undefined): number[] {
  return strList(value)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
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

  /**
   * 备份目录。绝对路径直接用，相对路径按 server/ 解析。
   * 默认放在项目上一级的 backup/ 下 —— 刻意不写死某个面板的绝对路径，
   * 换台机器、换个面板都能直接用；要放到别处（例如面板的备份目录）就在 .env 里配 BACKUP_DIR。
   */
  const rawBackupDir = env.BACKUP_DIR?.trim() || '../backup'
  const backupDir = path.isAbsolute(rawBackupDir) ? rawBackupDir : path.resolve(rootDir, rawBackupDir)

  const adminUserIds = intList(env.ADMIN_USER_IDS)
  const adminAccounts = strList(env.ADMIN_ACCOUNTS).map((s) => s.toLowerCase())

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
    adminUserIds,
    adminAccounts,
    backupDir,
    backupKeepDays: Math.max(1, num(env.BACKUP_KEEP_DAYS, 30)),
    logFile: env.LOG_FILE?.trim() || null,
  }
}

/**
 * 是不是管理员。
 * 会话里带着 userId 与 email，所以这里不用查库 —— 白名单本来就是配置。
 * 两个名单是"或"关系：配 ADMIN_USER_IDS=6 或 ADMIN_ACCOUNTS=admin 都行。
 */
export function isAdminSession(config: AppConfig, session: { userId: number; email: string }): boolean {
  if (config.adminUserIds.includes(session.userId)) return true
  const email = session.email.toLowerCase()
  return email !== '' && config.adminAccounts.includes(email)
}

/** 启动时提醒一次:没配任何管理员的话，站长控制台是进不去的 */
export function warnIfNoAdmin(config: AppConfig): void {
  if (config.adminUserIds.length === 0 && config.adminAccounts.length === 0) {
    console.warn('[配置] 未配置管理员(ADMIN_USER_IDS / ADMIN_ACCOUNTS)，站长控制台将无法访问')
  }
}
