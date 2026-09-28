import type { Database } from '../db/index.ts'

/**
 * 运行时设置。
 *
 * 这里**只放"运营期需要随手改"的项**。部署期配置(JWT_SECRET / DATABASE_PATH /
 * PORT / COOKIE_SECURE)只留在 .env，后台不提供任何读写入口 —— 把它们放进数据库
 * 只会扩大攻击面，而且改错一次就可能让服务起不来。
 *
 * 键名用白名单收窄，避免前端传任意 key 把这张表当草稿纸用。
 */
export const SETTING_KEYS = ['allow_register', 'feedback_enabled', 'invite_required'] as const
export type SettingKey = (typeof SETTING_KEYS)[number]

function isSettingKey(value: string): value is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(value)
}

/** 表里没有记录时的回落值(来自 .env 或代码默认) */
export type SettingDefaults = Record<SettingKey, boolean>

function parseBool(value: string): boolean {
  return value === 'true' || value === '1'
}

export function getBoolSetting(db: Database, key: SettingKey, fallback: boolean): boolean {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? parseBool(row.value) : fallback
}

export function setBoolSetting(db: Database, key: SettingKey, value: boolean): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value ? 'true' : 'false', new Date().toISOString())
}

export interface SettingView {
  key: SettingKey
  value: boolean
  /** 是否被后台改过(表里有记录)。没改过时显示的是 .env 里的值 */
  overridden: boolean
}

/**
 * 列出全部可调项。
 * 注意：查表不用缓存 —— SQLite 本地查询是微秒级，为此维护一份会失效的缓存不值得。
 */
export function listSettings(db: Database, defaults: SettingDefaults): SettingView[] {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const stored = new Map<string, boolean>()
  for (const row of rows) {
    if (isSettingKey(row.key)) stored.set(row.key, parseBool(row.value))
  }
  return SETTING_KEYS.map((key) => ({
    key,
    value: stored.get(key) ?? defaults[key],
    overridden: stored.has(key),
  }))
}
