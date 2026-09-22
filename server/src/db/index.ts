import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './schema.ts'

export type Database = DatabaseSync

/**
 * 打开数据库并应用迁移。
 *
 * 用 Node 内置的 node:sqlite:整个后端因此没有任何需要编译的原生模块
 * (better-sqlite3 / bcrypt 那类在便宜的云服务器上经常装不上)。
 * 需要 Node >= 22.5,版本不够时给一句明确的提示而不是一句莫名的模块找不到。
 */
export async function openDatabase(databasePath: string): Promise<Database> {
  let DatabaseSyncCtor: typeof DatabaseSync
  try {
    ;({ DatabaseSync: DatabaseSyncCtor } = await import('node:sqlite'))
  } catch {
    throw new Error(
      `当前 Node 版本(${process.version})不支持内置 SQLite。请升级到 Node 22.6 或更高版本后再启动。`
    )
  }

  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  }

  const db = new DatabaseSyncCtor(databasePath)

  // WAL:读写并发更好，崩溃恢复更稳(内存库不支持，跳过)
  if (databasePath !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA synchronous = NORMAL')

  migrate(db)
  return db
}

/** 按版本号顺序执行尚未应用的迁移;每条在自己的事务里，失败不会留下半个结构 */
export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at TEXT    NOT NULL
    )
  `)

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]
  const applied = new Set(appliedRows.map((r) => r.version))

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString()
      )
      db.exec('COMMIT')
      console.log(`[数据库] 已应用迁移 v${migration.version} (${migration.name})`)
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(
        `迁移 v${migration.version} (${migration.name}) 失败：${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}
