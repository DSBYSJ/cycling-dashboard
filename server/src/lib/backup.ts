import fs from 'node:fs'
import path from 'node:path'
import type { Database } from '../db/index.ts'

/**
 * 数据库备份。
 *
 * 用 SQLite 的 `VACUUM INTO` 而不是拷贝文件：WAL 模式下最新的写入可能还在
 * `cycling.db-wal` 里，直接 cp 会拿到「落后若干分钟」甚至损坏的副本。
 * `VACUUM INTO` 由 SQLite 自己生成事务一致的完整快照，不用停服务。
 *
 * ⚠️ 文件名规则(`cycling-<ISO 时间戳>.db`)与 `server/scripts/backup.mjs` 保持一致。
 * 那个脚本给 cron 用，刻意不 import 本项目任何代码（零依赖、最不容易坏），
 * 所以这里是第二份实现 —— **改动要同步两边**。
 */

/** 备份文件名白名单：同时用来防路径穿越（`..` / 绝对路径都进不来） */
export const BACKUP_FILE_RE = /^cycling-[0-9T-]+\.db$/

export interface BackupFile {
  name: string
  sizeKb: number
  createdAt: string
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

/**
 * 生成一份快照。
 * 注意：VACUUM INTO 的目标路径不能用参数绑定，只能拼进语句 ——
 * 这里路径由我们自己生成，不接受任何外部输入。
 */
export function createBackup(db: Database, outDir: string): BackupFile {
  fs.mkdirSync(outDir, { recursive: true })
  const name = `cycling-${stamp()}.db`
  const target = path.join(outDir, name)
  if (fs.existsSync(target)) throw new Error('同一秒内重复备份，请稍后再试')

  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  const stat = fs.statSync(target)
  return { name, sizeKb: Math.round(stat.size / 1024), createdAt: stat.mtime.toISOString() }
}

export function listBackups(outDir: string): BackupFile[] {
  if (!fs.existsSync(outDir)) return []
  return fs
    .readdirSync(outDir)
    .filter((name) => BACKUP_FILE_RE.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(outDir, name))
      return { name, sizeKb: Math.round(stat.size / 1024), createdAt: stat.mtime.toISOString() }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** 删除一份备份。名字必须先过白名单，避免 `../` 之类把别的文件删掉 */
export function deleteBackup(outDir: string, name: string): boolean {
  if (!BACKUP_FILE_RE.test(name)) throw new Error('备份文件名不合法')
  const full = path.join(outDir, name)
  if (!fs.existsSync(full)) return false
  fs.unlinkSync(full)
  return true
}

/** 清理超过保留天数的备份，返回删除数量 */
export function pruneBackups(outDir: string, keepDays: number): number {
  const cutoff = Date.now() - keepDays * 86_400_000
  let removed = 0
  for (const item of listBackups(outDir)) {
    if (new Date(item.createdAt).getTime() < cutoff) {
      fs.unlinkSync(path.join(outDir, item.name))
      removed += 1
    }
  }
  return removed
}

/** 目录概况，后台「备份管理」顶部显示 */
export function backupDirInfo(outDir: string, keepDays: number): { dir: string; count: number; totalKb: number; keepDays: number } {
  const items = listBackups(outDir)
  return {
    dir: outDir,
    count: items.length,
    totalKb: items.reduce((sum, item) => sum + item.sizeKb, 0),
    keepDays,
  }
}
