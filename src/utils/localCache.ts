import type { Bike, DayCheckIn, RideRecord } from '../types'

/**
 * 本地缓存（IndexedDB）。
 *
 * 现在的定位和以前完全不同：**云端是唯一数据源，这里只是「离线能看一眼」的副本**。
 * 因此本文件的所有写入都是 best-effort —— 缓存失败绝不能影响主流程。
 *
 * 两个数据库：
 *  · 旧库 `cycling-dashboard`（v3）：老版本把数据存在这里。现在只作为**迁移来源**读取，
 *    不写入也不删除（万一迁移出问题，原数据还在）。
 *  · 每用户缓存 `cycling-dashboard-cache-u<用户ID>`：按用户分库，
 *    避免「A 退出、B 登录后看到 A 的记录」这种串号事故。
 */

export type CacheStore = 'rides' | 'bikes' | 'days'
export const CACHE_STORES: readonly CacheStore[] = ['rides', 'bikes', 'days'] as const

const LEGACY_DB = 'cycling-dashboard'
const CACHE_DB_PREFIX = 'cycling-dashboard-cache-'
const CACHE_DB_VERSION = 1
const MIGRATED_KEY = (userKey: string) => `cycling-dashboard:migrated:${userKey}`

/** 本次会话内缓存是否已经失败过（配额满/隐私模式），失败后不再反复重试拖慢界面 */
let cacheDisabled = false

/** 缓存不可用（配额满、隐私模式、浏览器不支持）时抛出，调用方一律忽略 */
export class CacheUnavailableError extends Error {
  constructor(message = '本地缓存不可用') {
    super(message)
    this.name = 'CacheUnavailableError'
  }
}

export function isCacheDisabled(): boolean {
  return cacheDisabled
}

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null
}

function openCacheDB(userKey: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) {
      reject(new CacheUnavailableError('浏览器不支持 IndexedDB'))
      return
    }
    const req = indexedDB.open(`${CACHE_DB_PREFIX}${userKey}`, CACHE_DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const store of CACHE_STORES) {
        if (!db.objectStoreNames.contains(store)) {
          // 缓存记录里带上 userId，便于排查「这份缓存属于谁」
          db.createObjectStore(store, { keyPath: 'id' })
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new CacheUnavailableError(req.error?.message ?? 'IndexedDB 打开失败'))
    // 隐私模式下有时既不触发 success 也不触发 error，靠这一条兜底
    req.onblocked = () => reject(new CacheUnavailableError('IndexedDB 被其它标签页占用'))
  })
}

/**
 * 缓存写入的统一入口：任何失败都转成 CacheUnavailableError，
 * 配额溢出时顺手把缓存清掉（宁可没有缓存，也不能让主流程失败）。
 */
async function withCache<T>(userKey: string, run: (db: IDBDatabase) => Promise<T>, fallback: T): Promise<T> {
  if (cacheDisabled) return fallback
  let db: IDBDatabase | null = null
  try {
    db = await openCacheDB(userKey)
    return await run(db)
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22)) {
      cacheDisabled = true
      // 缓存满了就把整套清掉，给主流程让路（云端数据不受影响）
      try {
        indexedDB.deleteDatabase(`${CACHE_DB_PREFIX}${userKey}`)
      } catch {
        /* 清不掉也无所谓 */
      }
    }
    return fallback
  } finally {
    db?.close()
  }
}

function promiseRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'))
  })
}

/* ---------------- 每用户缓存读写 ---------------- */

export function readCache<T>(userKey: string, store: CacheStore): Promise<T[]> {
  return withCache<T[]>(
    userKey,
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        if (!db.objectStoreNames.contains(store)) {
          resolve([])
          return
        }
        const tx = db.transaction(store, 'readonly')
        promiseRequest(tx.objectStore(store).getAll() as IDBRequest<T[]>).then(resolve, reject)
      }),
    []
  )
}

/**
 * 用云端全量覆盖某个表。
 *
 * `prefer` 用来解决一个真实踩到的问题：骑行记录的**列表接口不带轨迹**，
 * 而缓存里可能已经存着某条记录的完整轨迹（之前点开时拉过详情）。
 * 如果直接覆盖，每次刷新都会把已缓存的轨迹抹掉 —— 表现为「第一次打开能看轨迹，
 * 刷新一次就没了」。所以由调用方决定「新的和已有的怎么取舍」。
 */
export function replaceCache<T extends { id: string }>(
  userKey: string,
  store: CacheStore,
  items: T[],
  prefer?: (incoming: T, existing: T | undefined) => T
): Promise<void> {
  return withCache<void>(
    userKey,
    (db) =>
      new Promise<void>((resolve, reject) => {
        if (!db.objectStoreNames.contains(store)) {
          resolve()
          return
        }
        const tx = db.transaction(store, 'readwrite')
        const objectStore = tx.objectStore(store)
        const putAll = (existing: Map<string, T>) => {
          objectStore.clear()
          for (const item of items) {
            const previous = existing.get(item.id)
            objectStore.put(prefer ? prefer(item, previous) : item)
          }
        }
        if (!prefer) {
          putAll(new Map())
        } else {
          // 先把已有内容读出来，才能做「保留更完整的那个」
          const readReq = objectStore.getAll() as IDBRequest<T[]>
          readReq.onsuccess = () => {
            putAll(new Map((readReq.result ?? []).map((row) => [row.id, row])))
          }
          readReq.onerror = () => putAll(new Map())
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('缓存写入失败'))
        tx.onabort = () => reject(tx.error ?? new Error('缓存写入被中止'))
      }),
    undefined as void
  )
}

/** 写入若干条（同 id 覆盖），不影响其它记录 */
export function putCacheMany<T extends { id: string }>(userKey: string, store: CacheStore, items: T[]): Promise<void> {
  if (items.length === 0) return Promise.resolve()
  return withCache<void>(
    userKey,
    (db) =>
      new Promise<void>((resolve, reject) => {
        if (!db.objectStoreNames.contains(store)) {
          resolve()
          return
        }
        const tx = db.transaction(store, 'readwrite')
        const objectStore = tx.objectStore(store)
        for (const item of items) objectStore.put(item)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('缓存写入失败'))
      }),
    undefined as void
  )
}

export function removeFromCache(userKey: string, store: CacheStore, id: string): Promise<void> {
  return withCache<void>(
    userKey,
    (db) =>
      new Promise<void>((resolve, reject) => {
        if (!db.objectStoreNames.contains(store)) {
          resolve()
          return
        }
        const tx = db.transaction(store, 'readwrite')
        tx.objectStore(store).delete(id)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('缓存删除失败'))
      }),
    undefined as void
  )
}

/* ---------------- 旧数据（迁移来源） ---------------- */

function openLegacyDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) {
      reject(new CacheUnavailableError('浏览器不支持 IndexedDB'))
      return
    }
    // 不指定版本：打开现有版本，不会触发升级
    const req = indexedDB.open(LEGACY_DB)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new CacheUnavailableError('旧数据打开失败'))
  })
}

async function readLegacyStore<T>(db: IDBDatabase, store: CacheStore): Promise<T[]> {
  if (!db.objectStoreNames.contains(store)) return []
  return new Promise<T[]>((resolve) => {
    const tx = db.transaction(store, 'readonly')
    promiseRequest(tx.objectStore(store).getAll() as IDBRequest<T[]>).then(
      (items) => resolve(items ?? []),
      () => resolve([])
    )
  })
}

export interface LegacyData {
  rides: RideRecord[]
  bikes: Bike[]
  days: DayCheckIn[]
}

/** 读取老版本留在浏览器里的数据（用于首次登录时上传到云端） */
export async function readLegacyData(): Promise<LegacyData> {
  const empty: LegacyData = { rides: [], bikes: [], days: [] }
  let db: IDBDatabase | null = null
  try {
    db = await openLegacyDB()
    const [rides, bikes, days] = await Promise.all([
      readLegacyStore<RideRecord>(db, 'rides'),
      readLegacyStore<Bike>(db, 'bikes'),
      readLegacyStore<DayCheckIn>(db, 'days'),
    ])
    return { rides, bikes, days }
  } catch {
    return empty
  } finally {
    db?.close()
  }
}

export function legacyHasData(data: LegacyData): boolean {
  return data.rides.length > 0 || data.bikes.length > 0 || data.days.length > 0
}

/** 是否已经为这个账号做过迁移（避免每次登录都重复上传） */
export function isMigrated(userKey: string): boolean {
  try {
    return localStorage.getItem(MIGRATED_KEY(userKey)) === '1'
  } catch {
    return false
  }
}

export function markMigrated(userKey: string): void {
  try {
    localStorage.setItem(MIGRATED_KEY(userKey), '1')
  } catch {
    /* localStorage 不可用就算了，最多下次再问一次 */
  }
}
