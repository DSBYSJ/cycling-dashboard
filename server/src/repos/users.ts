import type { Database } from '../db/index.ts'

export interface UserRow {
  id: number
  email: string
  password_hash: string
  display_name: string | null
  created_at: string
  updated_at: string
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

export function updateUserPassword(db: Database, userId: number, passwordHash: string): void {
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    passwordHash,
    new Date().toISOString(),
    userId
  )
}
