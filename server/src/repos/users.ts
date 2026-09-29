import type { Database } from '../db/index.ts'

export type UserStatus = 'active' | 'disabled'

export interface UserRow {
  id: number
  email: string
  password_hash: string
  display_name: string | null
  created_at: string
  updated_at: string
  status: UserStatus
  last_login_at: string | null
  token_version: number
}

/** 对外暴露的用户信息:绝不包含 password_hash */
export interface PublicUser {
  id: number
  email: string
  displayName: string | null
  createdAt: string
}

export function toPublicUser(row: UserRow): PublicUser {
  return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at }
}

export function findUserByEmail(db: Database, email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
}

export function findUserById(db: Database, id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
}

/** 创建用户。邮箱重复时由数据库唯一索引兜底(调用方需要捕获并转成友好提示) */
export function createUser(db: Database, email: string, passwordHash: string): UserRow {
  const now = new Date().toISOString()
  const result = db
    .prepare('INSERT INTO users (email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)')
    .run(email, passwordHash, now, now)
  return findUserById(db, Number(result.lastInsertRowid)) as UserRow
}

/**
 * 改密码。
 * 顺带自增令牌版本 —— 改密意味着"此前签发的登录态一律作废"，
 * 否则密码被改过之后，偷走令牌的人还能继续用。
 * 调用方如果希望当前设备保持登录，要重新签发一个令牌(见 auth/routes.ts 的改密接口)。
 */
export function updateUserPassword(db: Database, userId: number, passwordHash: string): void {
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?').run(
    passwordHash,
    new Date().toISOString(),
    userId
  )
}

/** 停用/启用。同样自增令牌版本，让已签发的令牌立即失效 */
export function setUserStatus(db: Database, userId: number, status: UserStatus): void {
  db.prepare('UPDATE users SET status = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?').run(
    status,
    new Date().toISOString(),
    userId
  )
}

/** 登录成功时记一笔，用户列表里用来看活跃度 */
export function touchLastLogin(db: Database, userId: number): void {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), userId)
}

/** 删除账号。rides / bikes / days 都是 ON DELETE CASCADE，会一并清掉 */
export function deleteUser(db: Database, userId: number): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(userId)
}

/* ---------------- 后台用 ---------------- */

export interface AdminUserRow {
  id: number
  email: string
  displayName: string | null
  status: UserStatus
  createdAt: string
  lastLoginAt: string | null
  rideCount: number
  bikeCount: number
  dayCount: number
}

/** 排序方式用白名单映射到 SQL 片段 —— 绝不让调用方传进来的字符串直接拼进语句 */
const SORT_SQL = {
  newest: 'u.id DESC',
  oldest: 'u.id ASC',
  rides: 'ride_count DESC, u.id DESC',
  active: 'u.last_login_at IS NULL, u.last_login_at DESC',
} as const
export type UserSort = keyof typeof SORT_SQL

export function isUserSort(value: unknown): value is UserSort {
  return typeof value === 'string' && value in SORT_SQL
}

export function listUsers(
  db: Database,
  opts: { limit: number; offset: number; search?: string; sort?: UserSort }
): { items: AdminUserRow[]; total: number } {
  const search = (opts.search ?? '').trim().toLowerCase()
  const like = `%${search}%`
  const where = search ? `WHERE LOWER(u.email) LIKE ? OR LOWER(IFNULL(u.display_name, '')) LIKE ?` : ''
  const filterParams: string[] = search ? [like, like] : []

  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM users u ${where}`).get(...filterParams) as { c: number }

  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.status, u.created_at, u.last_login_at,
              (SELECT COUNT(*) FROM rides r WHERE r.user_id = u.id) AS ride_count,
              (SELECT COUNT(*) FROM bikes b WHERE b.user_id = u.id) AS bike_count,
              (SELECT COUNT(*) FROM days d WHERE d.user_id = u.id) AS day_count
       FROM users u
       ${where}
       ORDER BY ${SORT_SQL[opts.sort ?? 'newest']}
       LIMIT ? OFFSET ?`
    )
    .all(...filterParams, opts.limit, opts.offset) as Record<string, unknown>[]

  return {
    items: rows.map((r) => ({
      id: r.id as number,
      email: r.email as string,
      displayName: (r.display_name as string | null) ?? null,
      status: r.status as UserStatus,
      createdAt: r.created_at as string,
      lastLoginAt: (r.last_login_at as string | null) ?? null,
      rideCount: r.ride_count as number,
      bikeCount: r.bike_count as number,
      dayCount: r.day_count as number,
    })),
    total: totalRow.c,
  }
}

export function countUsers(db: Database): { total: number; disabled: number; registeredLast7d: number } {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) AS disabled,
              SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS recent
       FROM users`
    )
    .get(since) as { total: number; disabled: number | null; recent: number | null }
  return { total: row.total, disabled: row.disabled ?? 0, registeredLast7d: row.recent ?? 0 }
}
