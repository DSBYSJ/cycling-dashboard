import crypto from 'node:crypto'
import fs from 'node:fs'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { isAdminSession, type AppConfig } from '../config.ts'
import type { Database } from '../db/index.ts'
import { AppError, badRequest, notFound } from '../lib/errors.ts'
import { makeAdminHook } from '../lib/http.ts'
import {
  SETTING_KEYS,
  getBoolSetting,
  listSettings,
  setBoolSetting,
  type SettingDefaults,
  type SettingKey,
} from '../lib/settings.ts'
import { listAuditLog, pruneAuditLog, recordAudit } from '../repos/audit.ts'
import { backupDirInfo, createBackup, deleteBackup, listBackups, pruneBackups } from '../lib/backup.ts'
import { countRides, countRidesCreatedSince, deleteRide, getRide, listAllRides, rideStats } from '../repos/rides.ts'
import {
  countUsers,
  deleteUser,
  findUserById,
  isUserSort,
  listUsers,
  setUserStatus,
  updateUserPassword,
  type UserStatus,
} from '../repos/users.ts'
import { hashPassword } from '../auth/password.ts'
import { countInviteCodes, createInviteCode, deleteInviteCode, listInviteCodes } from '../repos/invite.ts'
import { parsePagination, validatePassword } from '../lib/validate.ts'

/* ---------------- 小工具 ---------------- */

function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function int(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) ? n : null
}

function bodyOf(request: FastifyRequest): Record<string, unknown> {
  return (request.body ?? {}) as Record<string, unknown>
}

function queryOf(request: FastifyRequest): Record<string, unknown> {
  return (request.query ?? {}) as Record<string, unknown>
}

function paramsOf(request: FastifyRequest): Record<string, unknown> {
  return (request.params ?? {}) as Record<string, unknown>
}

/** 运行时设置的默认值：注册开关回落到 .env，其余默认关 */
function settingDefaults(config: AppConfig): SettingDefaults {
  return {
    allow_register: config.allowRegister,
    invite_required: false,
    changelog_enabled: true,
  }
}

function countRows(db: Database, table: 'bikes' | 'days'): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  return row.n
}

/** 某个账号的数据量，用户详情页用 */
function userDataCounts(db: Database, userId: number) {
  const one = (table: 'rides' | 'bikes' | 'days') =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(userId) as { n: number }).n
  return { rides: one('rides'), bikes: one('bikes'), days: one('days') }
}

/** 临时密码：去掉容易看错的 0/O/1/l/I，方便站长截图或口头转达 */
function tempPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.randomBytes(16), (b) => alphabet[b % alphabet.length]).join('')
}

/** 邀请码：同样只用易读字符 */
function randomInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join('')
}

/** 只回读文件尾部(最多 256KB)，避免日志很大时把内存吃掉 */
function readTail(file: string, lines: number): string[] {
  const stat = fs.statSync(file)
  const start = Math.max(0, stat.size - 256 * 1024)
  const length = stat.size - start
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(length)
    fs.readSync(fd, buf, 0, length, start)
    return buf.toString('utf8').split('\n').slice(-lines)
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * 站长控制台。
 *
 * 两条硬规则:
 * 1) 权限只在后端判 —— 前端把入口藏起来只是体验，不是权限控制。
 *    整个插件用 `addHook('preHandler', requireAdmin)` 统一挂载，避免"漏写一个路由 = 一个越权漏洞"。
 * 2) 写操作都要落审计 —— 单人站也需要，因为出纠纷时它是唯一的举证材料。
 */
export function adminRoutes(db: Database, config: AppConfig): FastifyPluginAsync {
  return async (app) => {
    const requireAdmin = makeAdminHook(config, db)
    // 必须在注册路由之前挂载，否则对已注册的路由不生效
    app.addHook('preHandler', requireAdmin)

    const audit = (request: FastifyRequest, action: string, target?: string, detail?: unknown): void =>
      recordAudit(db, { actorId: request.user!.userId, action, target, detail, ip: request.ip })

    /* ============ 概览 ============ */

    app.get('/overview', async () => {
      let dbSizeKb = 0
      let walSizeKb = 0
      if (config.databasePath !== ':memory:' && fs.existsSync(config.databasePath)) {
        dbSizeKb = Math.round(fs.statSync(config.databasePath).size / 1024)
        const wal = `${config.databasePath}-wal`
        if (fs.existsSync(wal)) walSizeKb = Math.round(fs.statSync(wal).size / 1024)
      }
      const mem = process.memoryUsage()
      return {
        users: countUsers(db),
        rides: { total: countRides(db), last7d: countRidesCreatedSince(db, Date.now() - 7 * 86_400_000) },
        bikes: countRows(db, 'bikes'),
        days: countRows(db, 'days'),
        invites: countInviteCodes(db),
        storage: { dbSizeKb, walSizeKb, backup: backupDirInfo(config.backupDir, config.backupKeepDays) },
        server: {
          nodeVersion: process.version,
          platform: `${process.platform} ${process.arch}`,
          uptimeSec: Math.round(process.uptime()),
          rssMb: Math.round(mem.rss / 1024 / 1024),
          isProduction: config.isProduction,
        },
        settings: listSettings(db, settingDefaults(config)),
        recentUsers: listUsers(db, { limit: 5, offset: 0, sort: 'newest' }).items,
        recentAudit: listAuditLog(db, { limit: 8, offset: 0 }).items,
      }
    })

    /* ============ 用户管理 ============ */

    app.get('/users', async (request) => {
      const q = queryOf(request)
      const { limit, offset } = parsePagination(q, 20)
      return listUsers(db, {
        limit,
        offset,
        search: str(q.search, 100),
        sort: isUserSort(q.sort) ? q.sort : 'newest',
      })
    })

    app.get('/users/:id', async (request) => {
      const id = int(paramsOf(request).id)
      if (id == null) throw badRequest('用户 id 不合法')
      const user = findUserById(db, id)
      if (!user) throw notFound('用户不存在')

      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          status: user.status,
          createdAt: user.created_at,
          lastLoginAt: user.last_login_at,
          isAdmin: isAdminSession(config, { userId: user.id, email: user.email }),
          counts: userDataCounts(db, id),
        },
        recentRides: listAllRides(db, { limit: 10, offset: 0, userId: id }).items,
      }
    })

    /** 停用 / 启用。停用会让该账号已签发的令牌立即失效(令牌版本自增) */
    app.patch('/users/:id', async (request) => {
      const id = int(paramsOf(request).id)
      if (id == null) throw badRequest('用户 id 不合法')
      const user = findUserById(db, id)
      if (!user) throw notFound('用户不存在')

      const raw = str(bodyOf(request).status, 20)
      if (raw !== 'active' && raw !== 'disabled') throw badRequest('状态只能是 active 或 disabled')
      const status = raw as UserStatus

      // 防自锁之一：不能停用自己
      if (id === request.user!.userId) throw badRequest('不能停用当前登录的账号')
      // 防自锁之二：白名单里的管理员也不能停用 —— 停完就进不来后台了
      if (isAdminSession(config, { userId: user.id, email: user.email })) {
        throw badRequest('该账号在管理员白名单里，请先修改服务器 .env 再操作')
      }

      if (user.status !== status) {
        setUserStatus(db, id, status)
        audit(request, status === 'disabled' ? 'user.disable' : 'user.enable', `user:${id}`, { email: user.email })
      }
      return { id, email: user.email, status }
    })

    /** 重置密码。不传 password 就生成一个随机临时密码 */
    app.post('/users/:id/password', async (request) => {
      const id = int(paramsOf(request).id)
      if (id == null) throw badRequest('用户 id 不合法')
      const user = findUserById(db, id)
      if (!user) throw notFound('用户不存在')

      const raw = bodyOf(request).password
      let password: string
      let generated = false
      if (typeof raw === 'string' && raw.trim() !== '') {
        password = validatePassword(raw) // 与注册用同一套规则
      } else {
        password = tempPassword()
        generated = true
      }

      await updateUserPassword(db, id, await hashPassword(password))
      // 审计只记"发生了这件事"，**绝不记密码本身**
      audit(request, 'user.reset_password', `user:${id}`, { email: user.email, generated })
      // 明文只出现在这一个响应里：不落日志、不可回查
      return { password, generated }
    })

    app.delete('/users/:id', async (request) => {
      const id = int(paramsOf(request).id)
      if (id == null) throw badRequest('用户 id 不合法')
      const user = findUserById(db, id)
      if (!user) throw notFound('用户不存在')

      if (id === request.user!.userId) throw badRequest('不能删除当前登录的账号')
      if (isAdminSession(config, { userId: user.id, email: user.email })) {
        throw badRequest('该账号在管理员白名单里，请先修改服务器 .env 再操作')
      }

      // 破坏性操作要求"手打账号名"确认，而不是点一下「确定」
      const confirm = str(bodyOf(request).confirm, 200)
      if (confirm.toLowerCase() !== user.email.toLowerCase()) {
        throw badRequest(`请输入完整账号「${user.email}」以确认删除`)
      }

      deleteUser(db, id) // rides / bikes / days 由外键级联删除
      audit(request, 'user.delete', `user:${id}`, { email: user.email })
      return { ok: true, deletedUserId: id }
    })

    /* ============ 系统设置 ============ */

    app.get('/settings', async () => ({ items: listSettings(db, settingDefaults(config)) }))

    app.patch('/settings', async (request) => {
      const payload = bodyOf(request)
      const key = str(payload.key, 40)
      if (!(SETTING_KEYS as readonly string[]).includes(key)) throw badRequest('不支持的设置项')
      if (typeof payload.value !== 'boolean') throw badRequest('设置值必须是 true 或 false')

      const settingKey = key as SettingKey
      const before = getBoolSetting(db, settingKey, settingDefaults(config)[settingKey])
      setBoolSetting(db, settingKey, payload.value)
      if (before !== payload.value) {
        audit(request, 'setting.update', `setting:${settingKey}`, { from: before, to: payload.value })
      }
      return { items: listSettings(db, settingDefaults(config)) }
    })

    /* ============ 数据浏览 ============ */

    app.get('/rides', async (request) => {
      const q = queryOf(request)
      const { limit, offset } = parsePagination(q, 50)
      return listAllRides(db, {
        limit,
        offset,
        userId: int(q.userId) ?? undefined,
        from: str(q.from, 10) || undefined,
        to: str(q.to, 10) || undefined,
        city: str(q.city, 40) || undefined,
      })
    })

    app.get('/rides/:userId/:id', async (request) => {
      const userId = int(paramsOf(request).userId)
      const rideId = str(paramsOf(request).id, 64)
      if (userId == null || !rideId) throw badRequest('参数不合法')
      const ride = getRide(db, userId, rideId)
      if (!ride) throw notFound('记录不存在')
      return { ride }
    })

    app.delete('/rides/:userId/:id', async (request) => {
      const userId = int(paramsOf(request).userId)
      const rideId = str(paramsOf(request).id, 64)
      if (userId == null || !rideId) throw badRequest('参数不合法')
      if (!deleteRide(db, userId, rideId)) throw notFound('记录不存在')
      audit(request, 'ride.delete', `ride:${userId}/${rideId}`)
      return { ok: true }
    })

    app.get('/stats', async () => ({ ...rideStats(db), users: countUsers(db) }))

    /* ============ 备份管理 ============ */

    app.get('/backups', async () => ({
      info: backupDirInfo(config.backupDir, config.backupKeepDays),
      items: listBackups(config.backupDir),
    }))

    /** 手动触发一次备份。VACUUM INTO 是同步的，库小的时候瞬间完成 */
    app.post('/backups', async (request) => {
      let item
      try {
        item = createBackup(db, config.backupDir)
      } catch (err) {
        throw new AppError(500, 'backup_failed', `备份失败：${err instanceof Error ? err.message : String(err)}`)
      }
      const removed = pruneBackups(config.backupDir, config.backupKeepDays)
      audit(request, 'backup.create', item.name, { sizeKb: item.sizeKb, prunedOld: removed })
      return { item, removed }
    })

    app.delete('/backups/:name', async (request) => {
      const name = str(paramsOf(request).name, 120)
      let ok: boolean
      try {
        ok = deleteBackup(config.backupDir, name)
      } catch {
        throw badRequest('备份文件名不合法')
      }
      if (!ok) throw notFound('备份不存在')
      audit(request, 'backup.delete', name)
      return { ok: true }
    })

    /** 数据库自检：完整性 + 各表行数 */
    app.get('/db-status', async () => {
      const integrityRow = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[]
      return {
        integrity: String(Object.values(integrityRow)[0] ?? 'unknown'),
        tables: tables.map((t) => {
          const safe = t.name.replace(/"/g, '""') // 表名来自 sqlite_master，这里仍然转义一次
          const row = db.prepare(`SELECT COUNT(*) AS n FROM "${safe}"`).get() as { n: number }
          return { table: t.name, rows: row.n }
        }),
      }
    })

    /* ============ 审计日志 ============ */

    app.get('/audit', async (request) => {
      const q = queryOf(request)
      const { limit, offset } = parsePagination(q, 50)
      return listAuditLog(db, { limit, offset, action: str(q.action, 40) })
    })

    app.post('/audit/prune', async (request) => {
      const removed = pruneAuditLog(db, 5000)
      audit(request, 'audit.prune', undefined, { removed })
      return { removed }
    })

    /* ============ 注册邀请码 ============ */

    app.get('/invites', async () => ({ items: listInviteCodes(db) }))

    app.post('/invites', async (request) => {
      const payload = bodyOf(request)
      const maxUses = int(payload.maxUses) ?? 1
      if (maxUses < 1 || maxUses > 1000) throw badRequest('可用次数需在 1–1000 之间')

      let code = str(payload.code, 32).toUpperCase()
      if (code && !/^[A-Z0-9-]{4,32}$/.test(code)) {
        throw badRequest('邀请码只能包含字母、数字与连字符，长度 4–32')
      }
      if (!code) code = randomInviteCode()
      if (listInviteCodes(db).some((item) => item.code === code)) throw badRequest('该邀请码已存在')

      const expiresAt = str(payload.expiresAt, 40) || null
      const note = str(payload.note, 100) || null
      const item = createInviteCode(db, { code, maxUses, expiresAt, note })
      audit(request, 'invite.create', `invite:${code}`, { maxUses, expiresAt })
      return { item }
    })

    app.delete('/invites/:code', async (request) => {
      const code = str(paramsOf(request).code, 32).toUpperCase()
      if (!code) throw badRequest('邀请码不合法')
      if (!deleteInviteCode(db, code)) throw notFound('邀请码不存在')
      audit(request, 'invite.delete', `invite:${code}`)
      return { ok: true }
    })

    /* ============ 系统信息 ============ */

    app.get('/logs', async (request) => {
      const lines = Math.min(Math.max(int(queryOf(request).lines) ?? 200, 10), 2000)
      if (!config.logFile) {
        return {
          configured: false,
          file: null,
          lines: [],
          hint: '未配置 LOG_FILE；可到宝塔面板 → Node 项目 → 日志里查看',
        }
      }
      if (!fs.existsSync(config.logFile)) {
        return { configured: true, file: config.logFile, lines: [], hint: '日志文件还不存在' }
      }
      try {
        return { configured: true, file: config.logFile, lines: readTail(config.logFile, lines) }
      } catch (err) {
        throw new AppError(500, 'log_read_failed', `读取日志失败：${err instanceof Error ? err.message : String(err)}`)
      }
    })

    /**
     * 环境变量一览。
     * **只列键名与"是否已配置"，绝不返回任何值** ——
     * 这一屏的作用是让站长确认部署有没有漏项，不是用来查看配置内容的。
     */
    app.get('/env', async () => {
      const keys = [
        'NODE_ENV',
        'PORT',
        'HOST',
        'DATABASE_PATH',
        'SESSION_DAYS',
        'COOKIE_SECURE',
        'ALLOW_REGISTER',
        'TRUST_PROXY',
        'AUTH_RATE_LIMIT_MAX',
        'ADMIN_USER_IDS',
        'ADMIN_ACCOUNTS',
        'BACKUP_DIR',
        'BACKUP_KEEP_DAYS',
        'LOG_FILE',
        'JWT_SECRET',
      ]
      return {
        items: keys.map((key) => ({
          key,
          configured: (process.env[key] ?? '') !== '',
          secret: /SECRET|KEY|PASSWORD|TOKEN/i.test(key),
        })),
      }
    })
  }
}
