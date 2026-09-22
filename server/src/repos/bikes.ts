import type { Bike } from '../../../src/types.ts'
import type { Database } from '../db/index.ts'

/** 单车:同样以 (user_id, id) 为主键，所有查询都带 user_id */
const COLUMNS = `user_id, id, name, category, tire_type_id, tire_installed_at, tire_start_km, notes, created_at, updated_at`

const UPSERT = `
  INSERT INTO bikes (${COLUMNS})
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, id) DO UPDATE SET
    name = excluded.name, category = excluded.category, tire_type_id = excluded.tire_type_id,
    tire_installed_at = excluded.tire_installed_at, tire_start_km = excluded.tire_start_km,
    notes = excluded.notes, updated_at = excluded.updated_at
`

type Row = Record<string, unknown>

function toParams(userId: number, bike: Bike): (string | number | null)[] {
  return [
    userId,
    bike.id,
    bike.name,
    bike.category,
    bike.tireTypeId,
    bike.tireInstalledAt,
    bike.tireStartKm,
    bike.notes ?? null,
    Math.round(bike.createdAt),
    Math.round(bike.updatedAt),
  ]
}

function rowToBike(row: Row): Bike {
  return {
    id: String(row.id),
    name: String(row.name),
    category: row.category as Bike['category'],
    tireTypeId: String(row.tire_type_id),
    tireInstalledAt: String(row.tire_installed_at),
    tireStartKm: Number(row.tire_start_km ?? 0),
    notes: (row.notes as string | null) ?? undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function listBikes(db: Database, userId: number): Bike[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM bikes WHERE user_id = ? ORDER BY created_at ASC`)
    .all(userId) as Row[]
  return rows.map(rowToBike)
}

export function upsertBike(db: Database, userId: number, bike: Bike): void {
  db.prepare(UPSERT).run(...toParams(userId, bike))
}

export function upsertBikes(db: Database, userId: number, bikes: Bike[]): number {
  if (bikes.length === 0) return 0
  const stmt = db.prepare(UPSERT)
  db.exec('BEGIN')
  try {
    for (const bike of bikes) stmt.run(...toParams(userId, bike))
    db.exec('COMMIT')
    return bikes.length
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function deleteBike(db: Database, userId: number, id: string): boolean {
  const result = db.prepare('DELETE FROM bikes WHERE user_id = ? AND id = ?').run(userId, id)
  return Number(result.changes) > 0
}
