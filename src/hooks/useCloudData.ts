import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { api, type BulkResult, type RideListItem } from '../api/client'
import type { Bike, DayCheckIn, RideRecord } from '../types'
import { useAuth } from './useAuth'
import { putCacheMany, readCache, removeFromCache, replaceCache, type CacheStore } from '../utils/localCache'

/**
 * 数据层：**云端为主 + 本地只读缓存**。
 *
 * 与旧版的区别（旧版是纯本地 IndexedDB）：
 *  · 服务器是唯一数据源；本地 IndexedDB 降级成「离线也能看一眼」的副本，写入失败一律忽略。
 *  · 首屏先读缓存立刻渲染，再拉云端覆盖 —— 避免每次都白屏等网络。
 *  · 写入走「乐观更新 + 失败回滚」，且**离线时直接拒绝写入并说明原因**，
 *    而不是改了界面却存不进去（那才是真正让人丢掉数据的做法）。
 */

/** cloud = 已与服务器同步；cache = 连不上服务器，只能看离线副本（此时禁止写入） */
export type SyncState = 'loading' | 'cloud' | 'cache'

/** 合并写入：同 id 覆盖，并保持排序 */
function mergeSorted<T extends { id: string }>(prev: T[], incoming: T[], sortFn: (a: T, b: T) => number): T[] {
  if (incoming.length === 0) return prev
  const map = new Map(prev.map((item) => [item.id, item]))
  for (const item of incoming) map.set(item.id, item)
  return Array.from(map.values()).sort(sortFn)
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 同一浏览器开多个标签页时的同步。
 * 数据以云端为准，所以这里不需要传数据、也不需要合并冲突 —— 只需告诉其它标签页
 * 「有人改过了，重新拉一次」。postMessage 不会投递给发送者自己，因此不会自激。
 */
const channel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('cycling-dashboard') : null

interface Adapter<T extends { id: string }> {
  /** 本地缓存里的表名 */
  store: CacheStore
  sort: (a: T, b: T) => number
  fetchAll: () => Promise<T[]>
  put: (item: T) => Promise<unknown>
  putMany: (items: T[]) => Promise<BulkResult>
  remove: (id: string) => Promise<unknown>
  /** 写缓存时如何取舍「云端新数据」与「缓存里已有的」（默认直接用新数据） */
  preserve?: (incoming: T, existing: T | undefined) => T
}

interface Collection<T extends { id: string }> {
  items: T[]
  /** 供回调里读取「当前最新列表」，避免把 items 放进依赖导致函数频繁重建 */
  itemsRef: MutableRefObject<T[]>
  loading: boolean
  sync: SyncState
  error: string | null
  clearError: () => void
  save: (item: T) => Promise<boolean>
  saveMany: (items: T[]) => Promise<BulkResult | null>
  remove: (id: string) => Promise<boolean>
  /** 把一条更新后的记录合并进列表（不触发重新拉取） */
  patch: (item: T) => void
  refresh: () => Promise<void>
}

function useCloudCollection<T extends { id: string }>(adapter: Adapter<T>): Collection<T> {
  const { status, userKey, handleAuthFailure } = useAuth()
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [sync, setSync] = useState<SyncState>('loading')
  const [error, setError] = useState<string | null>(null)

  const itemsRef = useRef<T[]>([])
  itemsRef.current = items

  const refresh = useCallback(async () => {
    // 未登录 / 还在确认登录态：什么都不做（登录后会由依赖变化重新触发）
    if (status !== 'authenticated' || !userKey) {
      if (status === 'anonymous') {
        // 退出登录后必须清空内存数据，否则下一个登录的人会看到上一个人的记录
        setItems([])
        setSync('loading')
        setLoading(false)
      }
      return
    }

    // 1) 先上缓存：断网也能立刻看到内容
    const cached = await readCache<T>(userKey, adapter.store)
    if (cached.length > 0) {
      setItems([...cached].sort(adapter.sort))
      setSync('cache')
      setLoading(false)
    }

    // 2) 再拉云端，成功后覆盖缓存
    try {
      const fresh = await adapter.fetchAll()
      /*
       * 不能直接把列表结果当成全部数据：列表接口不带轨迹，而内存（或缓存）里可能
       * 已经存着之前拉过的完整详情。这里按同样的取舍规则合并一次 ——
       * 否则每刷新一次都要重新请求一遍详情，地图还会先消失再出现。
       */
      const known = new Map(itemsRef.current.map((item) => [item.id, item]))
      const merged = adapter.preserve
        ? fresh.map((item) => adapter.preserve!(item, known.get(item.id)))
        : fresh
      setItems([...merged].sort(adapter.sort))
      setSync('cloud')
      setError(null)
      void replaceCache(userKey, adapter.store, fresh, adapter.preserve)
    } catch (err) {
      // 会话失效会由 handleAuthFailure 统一踢回登录页，这里不必再提示
      if (!handleAuthFailure(err)) setSync('cache')
    } finally {
      setLoading(false)
    }
  }, [status, userKey, adapter, handleAuthFailure])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 其它标签页写入后，本页重新拉取一次（本页自己的写入不会触发）
  useEffect(() => {
    if (!channel || status !== 'authenticated') return
    const onMessage = () => void refresh()
    channel.addEventListener('message', onMessage)
    return () => channel.removeEventListener('message', onMessage)
  }, [refresh, status])

  /**
   * 乐观更新 + 失败回滚。
   * 离线（sync === 'cache'）时直接拒绝：让用户明确知道「现在改了也存不上」，
   * 比先改界面再悄悄丢掉要诚实得多。
   */
  const run = useCallback(
    async (optimistic: (prev: T[]) => T[], persist: () => Promise<void>): Promise<boolean> => {
      if (status !== 'authenticated') {
        setError('登录状态已失效，请重新登录')
        return false
      }
      if (sync === 'cache') {
        setError('当前连不上服务器，改动无法保存。请检查网络后重试')
        return false
      }
      const before = itemsRef.current
      setItems(optimistic(before))
      try {
        await persist()
        setError(null)
        channel?.postMessage('changed')
        return true
      } catch (err) {
        if (handleAuthFailure(err)) return false
        setItems(before)
        setError(describe(err))
        return false
      }
    },
    [status, sync, handleAuthFailure]
  )

  const save = useCallback(
    async (item: T): Promise<boolean> => {
      const ok = await run(
        (prev) => mergeSorted(prev, [item], adapter.sort),
        () => adapter.put(item).then(() => undefined)
      )
      if (ok && userKey) void putCacheMany(userKey, adapter.store, [item])
      return ok
    },
    [run, adapter, userKey]
  )

  const saveMany = useCallback(
    async (list: T[]): Promise<BulkResult | null> => {
      const box: { value: BulkResult | null } = { value: null }
      const ok = await run(
        (prev) => mergeSorted(prev, list, adapter.sort),
        async () => {
          box.value = await adapter.putMany(list)
        }
      )
      if (ok && userKey) void putCacheMany(userKey, adapter.store, list)
      return ok ? box.value : null
    },
    [run, adapter, userKey]
  )

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const ok = await run(
        (prev) => prev.filter((item) => item.id !== id),
        () => adapter.remove(id).then(() => undefined)
      )
      if (ok && userKey) void removeFromCache(userKey, adapter.store, id)
      return ok
    },
    [run, adapter, userKey]
  )

  const patch = useCallback(
    (item: T) => setItems((prev) => mergeSorted(prev, [item], adapter.sort)),
    [adapter.sort]
  )

  const clearError = useCallback(() => setError(null), [])

  return { items, itemsRef, loading, sync, error, clearError, save, saveMany, remove, patch, refresh }
}

/* ---------------- 骑行记录 ---------------- */

const rideSort = (a: RideListItem, b: RideListItem) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt

/** 分页把记录拉全（默认一页 200 条） */
async function fetchAllRides(): Promise<RideListItem[]> {
  const pageSize = 200
  const all: RideListItem[] = []
  for (let offset = 0; offset <= 10_000; offset += pageSize) {
    const page = await api.listRides({ limit: pageSize, offset })
    all.push(...page.items)
    if (page.items.length === 0 || all.length >= page.total) break
  }
  return all
}

/**
 * 提交前的保护：列表接口不返回轨迹（track 为空数组）。
 * 如果直接拿列表项去 PUT，服务端会把它当成完整替换 —— **服务器上真实的 GPS 轨迹会被清空**。
 * 所以这种情况下先把完整记录取回来，用「服务端的轨迹 + 本次要提交的元数据」拼出请求体。
 */
async function toWritableRide(ride: RideListItem): Promise<RideRecord> {
  if (!ride.hasTrack || ride.track.length > 0) return ride
  const { ride: full } = await api.getRide(ride.id)
  return { ...full, ...ride, track: full.track, speedSeries: full.speedSeries }
}

const rideAdapter: Adapter<RideListItem> = {
  store: 'rides',
  sort: rideSort,
  fetchAll: fetchAllRides,
  put: async (ride) => {
    await api.putRide(await toWritableRide(ride))
  },
  // 批量导入的记录自带完整轨迹（来自备份文件或旧数据迁移），无需补全
  putMany: (rides) => api.bulkRides(rides),
  remove: (id) => api.deleteRide(id),
  /**
   * 列表接口不带轨迹，而缓存里可能已经存着之前拉过的详情。
   * 直接覆盖会导致「刷新一次轨迹就没了」，所以这里保留缓存里更完整的那个。
   */
  preserve: (incoming, existing) => {
    if (!existing || incoming.track.length > 0 || existing.track.length === 0) return incoming
    return {
      ...incoming,
      track: existing.track,
      speedSeries: existing.speedSeries.length > 0 ? existing.speedSeries : incoming.speedSeries,
    }
  },
}

export function useRides() {
  const collection = useCloudCollection<RideListItem>(rideAdapter)
  const { userKey } = useAuth()
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null)
  /**
   * 每条记录最多尝试拉几次详情。
   * 不能用「拉过就不再拉」的集合：会话结束前列表可能被云端数据刷新覆盖
   * （列表不带轨迹），那种情况下需要允许再补一次。
   */
  const attemptsRef = useRef(new Map<string, number>())
  const MAX_DETAIL_ATTEMPTS = 3
  // 单独取出来，这样 useCallback 的依赖是稳定的函数/ref（collection 每次渲染都是新对象）
  const { itemsRef, patch } = collection

  /**
   * 按需补全轨迹：列表里没有 track，用户点开某条记录（看地图/速度曲线）时再取详情。
   * 这样首屏不会被几百 KB 的轨迹拖慢 —— 这是后端刻意不返回轨迹的原因。
   */
  const ensureDetail = useCallback(
    async (id: string) => {
      const current = itemsRef.current.find((r) => r.id === id)
      // 已经有轨迹、或这条本来就没有轨迹，都不用拉
      if (!current || current.track.length > 0 || !current.hasTrack) return
      const attempts = attemptsRef.current.get(id) ?? 0
      if (attempts >= MAX_DETAIL_ATTEMPTS) return
      attemptsRef.current.set(id, attempts + 1)
      setDetailLoadingId(id)
      try {
        const { ride } = await api.getRide(id)
        const withFlag: RideListItem = { ...ride, hasTrack: ride.track.length > 0 }
        patch(withFlag)
        if (userKey) void putCacheMany(userKey, 'rides', [withFlag])
      } catch {
        // 拉不到就让地图空着，不打断其它操作；下次需要时会再试（受尝试次数上限约束）
      } finally {
        setDetailLoadingId(null)
      }
    },
    [itemsRef, patch, userKey]
  )

  return {
    rides: collection.items,
    loading: collection.loading,
    sync: collection.sync,
    error: collection.error,
    clearError: collection.clearError,
    save: collection.save,
    saveMany: collection.saveMany,
    remove: collection.remove,
    refresh: collection.refresh,
    ensureDetail,
    detailLoadingId,
  }
}

/* ---------------- 单车 ---------------- */

const bikeSort = (a: Bike, b: Bike) => a.createdAt - b.createdAt

const bikeAdapter: Adapter<Bike> = {
  store: 'bikes',
  sort: bikeSort,
  fetchAll: async () => (await api.listBikes()).items,
  put: (bike) => api.putBike(bike),
  putMany: (bikes) => api.bulkBikes(bikes),
  remove: (id) => api.deleteBike(id),
}

export function useBikes() {
  const collection = useCloudCollection<Bike>(bikeAdapter)
  return {
    bikes: collection.items,
    loading: collection.loading,
    sync: collection.sync,
    error: collection.error,
    clearError: collection.clearError,
    save: collection.save,
    saveMany: collection.saveMany,
    remove: collection.remove,
    refresh: collection.refresh,
  }
}

/* ---------------- 每日打卡 ---------------- */

const daySort = (a: DayCheckIn, b: DayCheckIn) => b.date.localeCompare(a.date)

const dayAdapter: Adapter<DayCheckIn> = {
  store: 'days',
  sort: daySort,
  fetchAll: async () => (await api.listDays()).items,
  put: (day) => api.putDay(day),
  putMany: (days) => api.bulkDays(days),
  remove: (id) => api.deleteDay(id),
}

export function useDays() {
  const collection = useCloudCollection<DayCheckIn>(dayAdapter)
  return {
    days: collection.items,
    loading: collection.loading,
    sync: collection.sync,
    error: collection.error,
    clearError: collection.clearError,
    save: collection.save,
    saveMany: collection.saveMany,
    remove: collection.remove,
    refresh: collection.refresh,
  }
}
