import type { Database } from '../db/index.ts'

/**
 * 用户 → 站长的单向留言。
 *
 * 严格保持"单向、不公开"：用户看不到别人的留言，也看不到别人的回复 ——
 * 这样它就不构成"用户间信息发布"或"即时通讯"，合规上只相当于意见反馈。
 * 详见 docs/用户聊天功能合规评估.md
 */

export type FeedbackStatus = 'open' | 'done'

export interface FeedbackRow {
  id: number
  userId: number
  content: string
  status: FeedbackStatus
  reply: string | null
  repliedAt: string | null
  createdAt: string
}

function toRow(r: Record<string, unknown>): FeedbackRow {
  return {
    id: r.id as number,
    userId: r.user_id as number,
    content: r.content as string,
    status: r.status as FeedbackStatus,
    reply: (r.reply as string | null) ?? null,
    repliedAt: (r.replied_at as string | null) ?? null,
    createdAt: r.created_at as string,
  }
}

const COLUMNS = 'id, user_id, content, status, reply, replied_at, created_at'

/** 每人同时最多留 20 条未处理留言，避免有人刷爆后台(list) */
export const MAX_OPEN_FEEDBACK_PER_USER = 20

export function countOpenFeedbackByUser(db: Database, userId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM feedback WHERE user_id = ? AND status = 'open'`)
    .get(userId) as { c: number }
  return row.c
}

export function createFeedback(db: Database, userId: number, content: string): FeedbackRow {
  const result = db
    .prepare('INSERT INTO feedback (user_id, content, status, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, content, 'open', new Date().toISOString())
  const row = db.prepare(`SELECT ${COLUMNS} FROM feedback WHERE id = ?`).get(Number(result.lastInsertRowid)) as Record<
    string,
    unknown
  >
  return toRow(row)
}

/** 用户端：只看自己的 */
export function listFeedbackByUser(db: Database, userId: number, limit = 50): FeedbackRow[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM feedback WHERE user_id = ? ORDER BY id DESC LIMIT ?`)
    .all(userId, limit) as Record<string, unknown>[]
  return rows.map(toRow)
}

/* ---------------- 后台 ---------------- */

export interface AdminFeedbackRow extends FeedbackRow {
  userEmail: string
}

export function listAllFeedback(
  db: Database,
  opts: { limit: number; offset: number; status?: FeedbackStatus | '' }
): { items: AdminFeedbackRow[]; total: number } {
  const status = opts.status ?? ''
  const where = status ? 'WHERE f.status = ?' : ''
  const params: string[] = status ? [status] : []

  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM feedback f ${where}`).get(...params) as { c: number }

  const rows = db
    .prepare(
      `SELECT f.id, f.user_id, f.content, f.status, f.reply, f.replied_at, f.created_at, u.email AS user_email
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       ${where}
       ORDER BY f.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, opts.limit, opts.offset) as Record<string, unknown>[]

  return {
    items: rows.map((r) => ({ ...toRow(r), userEmail: (r.user_email as string | null) ?? '（账号已删除）' })),
    total: totalRow.c,
  }
}

export function countOpenFeedback(db: Database): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM feedback WHERE status = 'open'`).get() as { c: number }
  return row.c
}

/** 回复即视为已处理。返回是否命中该条 */
export function replyFeedback(db: Database, id: number, reply: string): boolean {
  const now = new Date().toISOString()
  const result = db
    .prepare(`UPDATE feedback SET reply = ?, status = 'done', replied_at = ? WHERE id = ?`)
    .run(reply, now, id)
  return Number(result.changes) > 0
}

export function setFeedbackStatus(db: Database, id: number, status: FeedbackStatus): boolean {
  const result = db.prepare('UPDATE feedback SET status = ? WHERE id = ?').run(status, id)
  return Number(result.changes) > 0
}
