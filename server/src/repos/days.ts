import type { DayCheckIn } from '../../../src/types.ts'
import type { Database } from '../db/index.ts'

/** 每日打卡:一个用户一天一条，(user_id, id) 为主键，重复打卡即为覆盖 */
const COLUMNS = `user_id, id, date, rode, bike_id, distance_km, ride_id, note, created_at`

const UPSERT = `
  INSERT INTO days (${COLUMNS})
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, id) DO UPDATE SET
    date = excluded.date, rode = excluded.rode, bike_id = excluded.bike_id,
    distance_km = excluded.distance_km, ride_id = excluded.ride_id, note = excluded.note
`

type Row = Record<string, unknown>

function toParams(userId: number, day: DayCheckIn): (string | number | null)[] {
  return [
    userId,
    day.id,
    day.date,
    day.rode ? 1 : 0,
    day.bikeId ?? null,
    day.distanceKm ?? null,
    day.rideId ?? null,
    day.note ?? null,
    Math.round(day.createdAt),
  ]
}

function rowToDay(row: Row): DayCheckIn {
  return {
    id: String(row.id),
    date: String(row.date),
    rode: row.rode === 1,
    bikeId: (row.bike_id as string | null) ?? undefined,
    distanceKm: (row.distance_km as number | null) ?? undefined,
    rideId: (row.ride_id as string | null) ?? undefined,
    note: (row.note as string | null) ?? undefined,
    createdAt: Number(row.created_at),
  }
}

export function listDays(db: Database, userId: number): DayCheckIn[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM days WHERE user_id = ? ORDER BY date DESC`)
    .all(userId) as Row[]
  return rows.map(rowToDay)
}

export function upsertDay(db: Database, userId: number, day: DayCheckIn): void {
  db.prepare(UPSERT).run(...toParams(userId, day))
}

export function upsertDays(db: Database, userId: number, days: DayCheckIn[]): number {
  if (days.length === 0) return 0
  const stmt = db.prepare(UPSERT)
  db.exec('BEGIN')
  try {
    for (const day of days) stmt.run(...toParams(userId, day))
    db.exec('COMMIT')
    return days.length
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function deleteDay(db: Database, userId: number, id: string): boolean {
  const result = db.prepare('DELETE FROM days WHERE user_id = ? AND id = ?').run(userId, id)
  return Number(result.changes) > 0
}
