import type { Database } from '../db/index.ts'

/**
 * 管理操作审计。
 *
 * 为什么单人站长也需要：一旦出现纠纷（"我的数据被你删了"），审计日志是唯一的举证材料。
 * 成本很低，价值很高，所以所有管理侧写操作都必须落一条。
 */

export interface AuditEntry {
  actorId: number
  /** 动作标识，如 user.disable / user.reset_password / setting.update */
  action: string
  /** 操作对象，如 'user:6' / 'setting:allow_register' */
  target?: string
  detail?: unknown
  ip?: string | null
}

export interface AuditRow {
  id: number
  actorId: number
  action: string
  target: string | null
  detail: string | null
  ip: string | null
  createdAt: string
}

/**
 * 记一条。
 *
 * 刻意**不抛异常**：审计写失败（磁盘满等极端情况）不应该阻断管理操作本身，
 * 但要打日志 —— 静默失败等于没有审计。
 */
export function recordAudit(db: Database, entry: AuditEntry): void {
  try {
    let detail: string | null = null
    if (entry.detail !== undefined) {
      const text = typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail)
      // 防止有人把超大对象塞进来把日志表撑爆
      detail = text.length > 2000 ? `${text.slice(0, 2000)}…` : text
    }
    db.prepare(
      `INSERT INTO admin_audit_log (actor_id, action, target, detail, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(entry.actorId, entry.action, entry.target ?? null, detail, entry.ip ?? null, new Date().toISOString())
  } catch (err) {
    console.error('[审计] 写入失败：', err instanceof Error ? err.message : String(err))
  }
}

export function listAuditLog(
  db: Database,
  opts: { limit: number; offset: number; action?: string }
): { items: AuditRow[]; total: number } {
  const action = (opts.action ?? '').trim()
  const where = action ? 'WHERE action LIKE ?' : ''
  const params: (string | number)[] = action ? [`${action}%`] : []

  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM admin_audit_log ${where}`).get(...params) as { c: number }

  const rows = db
    .prepare(
      `SELECT id, actor_id, action, target, detail, ip, created_at
       FROM admin_audit_log ${where}
       ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, opts.limit, opts.offset) as Record<string, unknown>[]

  return {
    items: rows.map((r) => ({
      id: r.id as number,
      actorId: r.actor_id as number,
      action: r.action as string,
      target: (r.target as string | null) ?? null,
      detail: (r.detail as string | null) ?? null,
      ip: (r.ip as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
    total: totalRow.c,
  }
}

/** 保留最近 N 条，避免日志表无限增长 */
export function pruneAuditLog(db: Database, keep = 5000): number {
  const result = db
    .prepare('DELETE FROM admin_audit_log WHERE id NOT IN (SELECT id FROM admin_audit_log ORDER BY id DESC LIMIT ?)')
    .run(keep)
  return Number(result.changes)
}
