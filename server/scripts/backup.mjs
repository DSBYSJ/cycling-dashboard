#!/usr/bin/env node
/**
 * 骑行看板数据库备份。
 *
 * 为什么不用 `cp cycling.db`：
 *   SQLite 默认跑在 WAL 模式下，最新的写入可能还在 cycling.db-wal 里，
 *   只拷主文件会得到一个「落后若干分钟」甚至损坏的副本。
 *   `VACUUM INTO` 由 SQLite 自己生成一个事务一致的完整快照 —— 不用停服务，
 *   也不会漏掉 WAL 里的内容。
 *
 * 用法：
 *   node scripts/backup.mjs [数据库路径] [备份目录]
 * 环境变量：
 *   BACKUP_KEEP_DAYS  保留天数，默认 30
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const here = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.argv[2] ?? path.resolve(here, '../data/cycling.db')
const outDir = process.argv[3] ?? '/www/backup/cycling-dashboard'
const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 30)

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`)

if (!fs.existsSync(dbPath)) {
  console.error(`[备份失败] 找不到数据库：${dbPath}`)
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })

// 带时间戳，避免同一天多次备份互相覆盖
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const target = path.join(outDir, `cycling-${stamp}.db`)

let db
try {
  db = new DatabaseSync(dbPath, { readOnly: true })
  // readOnly 下不能写，VACUUM INTO 的目标是另一个文件，所以没问题
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  const tables = db
    .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'")
    .get()
  log(`备份成功：${target}（${(fs.statSync(target).size / 1024).toFixed(1)} KB，库内 ${tables.c} 张表）`)
} catch (err) {
  console.error(`[备份失败] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
} finally {
  db?.close()
}

// 清理过期备份
const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000
let removed = 0
for (const name of fs.readdirSync(outDir)) {
  if (!/^cycling-.*\.db$/.test(name)) continue
  const full = path.join(outDir, name)
  if (fs.statSync(full).mtimeMs < cutoff) {
    fs.unlinkSync(full)
    removed += 1
  }
}
log(`清理 ${removed} 个超过 ${keepDays} 天的旧备份；当前共保留 ${fs.readdirSync(outDir).filter((n) => /^cycling-.*\.db$/.test(n)).length} 份`)
