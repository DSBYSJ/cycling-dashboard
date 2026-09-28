import type { Database } from '../db/index.ts'

/** 注册邀请码：把"对所有人开放注册"换成"凭码注册" */

export interface InviteCodeRow {
  code: string
  maxUses: number
  usedCount: number
  expiresAt: string | null
  note: string | null
  createdAt: string
}

export interface InviteUse {
  userId: number
  email: string
  usedAt: string
}

function toRow(r: Record<string, unknown>): InviteCodeRow {
  return {
    code: r.code as string,
    maxUses: r.max_uses as number,
    usedCount: r.used_count as number,
    expiresAt: (r.expires_at as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    createdAt: r.created_at as string,
  }
}

export function createInviteCode(
  db: Database,
  input: { code: string; maxUses: number; expiresAt: string | null; note: string | null }
): InviteCodeRow {
  db.prepare('INSERT INTO invite_codes (code, max_uses, used_count, expires_at, note, created_at) VALUES (?, ?, 0, ?, ?, ?)').run(
    input.code,
    input.maxUses,
    input.expiresAt,
    input.note,
    new Date().toISOString()
  )
  const row = db.prepare('SELECT * FROM invite_codes WHERE code = ?').get(input.code) as Record<string, unknown>
  return toRow(row)
}

export function listInviteCodes(db: Database): (InviteCodeRow & { uses: InviteUse[] })[] {
  const codes = (db.prepare('SELECT * FROM invite_codes ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(
    toRow
  )
  const uses = db
    .prepare(
      `SELECT iu.code, iu.user_id, iu.used_at, u.email
       FROM invite_uses iu LEFT JOIN users u ON u.id = iu.user_id
       ORDER BY iu.used_at DESC`
    )
    .all() as Record<string, unknown>[]

  const byCode = new Map<string, InviteUse[]>()
  for (const u of uses) {
    const code = u.code as string
    const list = byCode.get(code) ?? []
    list.push({
      userId: u.user_id as number,
      email: (u.email as string | null) ?? '（账号已删除）',
      usedAt: u.used_at as string,
    })
    byCode.set(code, list)
  }

  return codes.map((c) => ({ ...c, uses: byCode.get(c.code) ?? [] }))
}

export function deleteInviteCode(db: Database, code: string): boolean {
  const result = db.prepare('DELETE FROM invite_codes WHERE code = ?').run(code)
  return Number(result.changes) > 0
}

export function countInviteCodes(db: Database): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM invite_codes').get() as { c: number }
  return row.c
}

export type ConsumeResult = { ok: true } | { ok: false; reason: string }

/**
 * 只检查、不核销。
 * 注册流程里先检查（能在建账号之前就把无效码挡掉），等用户真的创建成功后再核销 ——
 * 否则"码核销了但账号没建成"会把名额白白吃掉。
 */
export function peekInviteCode(db: Database, code: string): ConsumeResult {
  const row = db.prepare('SELECT * FROM invite_codes WHERE code = ?').get(code) as Record<string, unknown> | undefined
  if (!row) return { ok: false, reason: '邀请码无效' }

  const invite = toRow(row)
  if (invite.expiresAt && invite.expiresAt < new Date().toISOString()) return { ok: false, reason: '邀请码已过期' }
  if (invite.usedCount >= invite.maxUses) return { ok: false, reason: '邀请码已用完' }
  return { ok: true }
}

/**
 * 校验并核销一个邀请码。
 *
 * 校验与"计数 +1 + 记录使用人"必须在一个事务里 —— 否则两个请求同时拿着最后
 * 一个名额注册时，会双双通过校验，把 max_uses 用超。
 */
export function consumeInviteCode(db: Database, code: string, userId: number): ConsumeResult {
  const row = db.prepare('SELECT * FROM invite_codes WHERE code = ?').get(code) as Record<string, unknown> | undefined
  if (!row) return { ok: false, reason: '邀请码无效' }

  const invite = toRow(row)
  if (invite.expiresAt && invite.expiresAt < new Date().toISOString()) {
    return { ok: false, reason: '邀请码已过期' }
  }
  if (invite.usedCount >= invite.maxUses) {
    return { ok: false, reason: '邀请码已用完' }
  }

  const now = new Date().toISOString()
  db.exec('BEGIN')
  try {
    // 带 used_count < max_uses 的乐观锁：并发下只有一个能改成功
    const updated = db
      .prepare('UPDATE invite_codes SET used_count = used_count + 1 WHERE code = ? AND used_count < max_uses')
      .run(code)
    if (Number(updated.changes) === 0) {
      db.exec('ROLLBACK')
      return { ok: false, reason: '邀请码已用完' }
    }
    db.prepare('INSERT INTO invite_uses (code, user_id, used_at) VALUES (?, ?, ?)').run(code, userId, now)
    db.exec('COMMIT')
    return { ok: true }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
