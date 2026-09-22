import type { RideRecord } from '../../../src/types.ts'
import type { Database } from '../db/index.ts'

/**
 * 骑行记录的读写。
 *
 * 两个刻意的设计:
 * 1) 表用 (user_id, id) 复合主键，每条 SQL 都带 user_id —— 用户隔离不靠应用层"记得过滤"，
 *    而是把它写进查询条件与主键，漏写就查不到数据。
 * 2) env / route / track / speedSeries / scores / suggestions 这些嵌套结构存成 JSON 列：
 *    它们整体读写、从不单独检索，拆成五张关联表只会让读写更慢更复杂。
 */

/** 列表项:不含体积最大的 track，避免"只看历史列表却下载了几十 MB 轨迹" */
export type RideListItem = Omit<RideRecord, 'track'> & { hasTrack: boolean }

const COLUMNS = `
  user_id, id, date, label, bike_id, check_in, duration_min, distance_km, avg_speed, max_speed,
  city_name, city_code, start_name, start_district, location_lat, location_lon,
  env_json, env_meta_json, route_json, track_json, route_name, speed_series_json, scores_json,
  comment, suggestions_json, notes, created_at, updated_at
`

/** node:sqlite 不接受 undefined 作为参数，统一转成 null */
function toParams(userId: number, ride: RideRecord): (string | number | null)[] {
  return [
    userId,
    ride.id,
    ride.date,
    ride.label ?? null,
    ride.bikeId ?? null,
    ride.checkIn ? 1 : 0,
    ride.durationMin ?? null,
    ride.distanceKm ?? null,
    ride.avgSpeed ?? null,
    ride.maxSpeed ?? null,
    ride.cityName ?? '',
    ride.cityCode ?? '',
    ride.startName ?? null,
    ride.startDistrict ?? null,
    ride.location?.lat ?? null,
    ride.location?.lon ?? null,
    JSON.stringify(ride.env ?? {}),
    JSON.stringify(ride.envMeta ?? {}),
    JSON.stringify(ride.route ?? {}),
    JSON.stringify(ride.track ?? []),
    ride.routeName ?? null,
    JSON.stringify(ride.speedSeries ?? []),
    ride.scores ? JSON.stringify(ride.scores) : null,
    ride.comment ?? '',
    JSON.stringify(ride.suggestions ?? []),
    ride.notes ?? '',
    Math.round(ride.createdAt),
    Math.round(ride.updatedAt),
  ]
}

const UPSERT = `
  INSERT INTO rides (${COLUMNS})
  VALUES (${COLUMNS.split(',').map(() => '?').join(',')})
  ON CONFLICT(user_id, id) DO UPDATE SET
    date = excluded.date, label = excluded.label, bike_id = excluded.bike_id, check_in = excluded.check_in,
    duration_min = excluded.duration_min, distance_km = excluded.distance_km, avg_speed = excluded.avg_speed,
    max_speed = excluded.max_speed, city_name = excluded.city_name, city_code = excluded.city_code,
    start_name = excluded.start_name, start_district = excluded.start_district,
    location_lat = excluded.location_lat, location_lon = excluded.location_lon,
    env_json = excluded.env_json, env_meta_json = excluded.env_meta_json, route_json = excluded.route_json,
    track_json = excluded.track_json, route_name = excluded.route_name,
    speed_series_json = excluded.speed_series_json, scores_json = excluded.scores_json,
    comment = excluded.comment, suggestions_json = excluded.suggestions_json, notes = excluded.notes,
    updated_at = excluded.updated_at
`

type Row = Record<string, unknown>

function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string' || text === '') return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    // 单行数据损坏不应该让整个列表接口 500，退化成默认值
    return fallback
  }
}

function rowToRide(row: Row, includeTrack: boolean): RideRecord {
  return {
    id: String(row.id),
    label: (row.label as string | null) ?? undefined,
    bikeId: (row.bike_id as string | null) ?? undefined,
    checkIn: row.check_in === 1 ? true : undefined,
    date: String(row.date),
    durationMin: (row.duration_min as number | null) ?? null,
    distanceKm: (row.distance_km as number | null) ?? null,
    avgSpeed: (row.avg_speed as number | null) ?? null,
    maxSpeed: (row.max_speed as number | null) ?? null,
    cityName: String(row.city_name ?? ''),
    cityCode: String(row.city_code ?? ''),
    startName: (row.start_name as string | null) ?? undefined,
    startDistrict: (row.start_district as string | null) ?? undefined,
    location:
      row.location_lat != null && row.location_lon != null
        ? { lat: row.location_lat as number, lon: row.location_lon as number }
        : null,
    env: parseJson(row.env_json, {} as RideRecord['env']),
    envMeta: parseJson(row.env_meta_json, {} as RideRecord['envMeta']),
    route: parseJson(row.route_json, {} as RideRecord['route']),
    track: includeTrack ? parseJson(row.track_json, [] as RideRecord['track']) : [],
    routeName: (row.route_name as string | null) ?? undefined,
    speedSeries: parseJson(row.speed_series_json, [] as RideRecord['speedSeries']),
    scores: row.scores_json == null ? null : parseJson(row.scores_json, null),
    comment: String(row.comment ?? ''),
    suggestions: parseJson(row.suggestions_json, [] as string[]),
    notes: String(row.notes ?? ''),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function listRides(
  db: Database,
  userId: number,
  options: { limit: number; offset: number; from?: string; to?: string }
): { items: RideListItem[]; total: number } {
  const where: string[] = ['user_id = ?']
  const params: (string | number)[] = [userId]
  if (options.from) {
    where.push('date >= ?')
    params.push(options.from)
  }
  if (options.to) {
    where.push('date <= ?')
    params.push(options.to)
  }
  const whereSql = where.join(' AND ')

  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM rides WHERE ${whereSql}`).get(...params) as { n: number }

  // 列表不查 track_json，只用一个长度判断标记"是否含轨迹"，前端按需再取详情
  const rows = db
    .prepare(
      `SELECT ${COLUMNS.replace('track_json', "(length(track_json) > 2) AS has_track")}
       FROM rides WHERE ${whereSql}
       ORDER BY date DESC, created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, options.limit, options.offset) as Row[]

  return {
    items: rows.map((row) => ({ ...rowToRide(row, false), hasTrack: row.has_track === 1 })),
    total: totalRow.n,
  }
}

export function getRide(db: Database, userId: number, id: string): RideRecord | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM rides WHERE user_id = ? AND id = ?`).get(userId, id) as Row | undefined
  return row ? rowToRide(row, true) : null
}

export function upsertRide(db: Database, userId: number, ride: RideRecord): void {
  db.prepare(UPSERT).run(...toParams(userId, ride))
}

/** 批量写入(本地数据迁移 / 备份恢复):单事务，要么全成功要么全回滚 */
export function upsertRides(db: Database, userId: number, rides: RideRecord[]): number {
  if (rides.length === 0) return 0
  const stmt = db.prepare(UPSERT)
  db.exec('BEGIN')
  try {
    for (const ride of rides) stmt.run(...toParams(userId, ride))
    db.exec('COMMIT')
    return rides.length
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function deleteRide(db: Database, userId: number, id: string): boolean {
  const result = db.prepare('DELETE FROM rides WHERE user_id = ? AND id = ?').run(userId, id)
  return Number(result.changes) > 0
}
