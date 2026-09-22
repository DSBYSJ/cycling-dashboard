import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type BulkResult } from '../api/client'
import { chunkByPayloadSize } from '../utils/chunks'
import { isMigrated, legacyHasData, markMigrated, readLegacyData, type LegacyData } from '../utils/localCache'
import { useAuth } from './useAuth'

/**
 * 「把以前存在这台浏览器里的记录搬到云端」。
 *
 * 为什么必须做：旧版本的数据只存在浏览器 IndexedDB 里，用户注册后如果不上传，
 * 打开新界面会是一条记录都没有 —— 看起来像数据丢了。
 *
 * 策略：
 *  · 云端为空（刚注册）→ 自动搬过去，并告知搬了多少条。
 *  · 云端已有数据 → **不自动动**，只提示还剩多少条本机记录，让用户自己点（避免意外重复/覆盖）。
 *  · 无论成功与否都**不删除本地旧数据** —— 迁移出问题还能手工找回。
 */

async function uploadRidesInChunks(rides: LegacyData['rides']): Promise<BulkResult> {
  let imported = 0
  let skipped = 0
  for (const chunk of chunkByPayloadSize(rides)) {
    const result = await api.bulkRides(chunk)
    imported += result.imported
    skipped += result.skipped
  }
  return { imported, skipped }
}

export type MigrationStatus = 'idle' | 'checking' | 'uploading' | 'done' | 'error'

export interface MigrationCounts {
  rides: number
  bikes: number
  days: number
}

export interface MigrationState {
  status: MigrationStatus
  /** 已成功上传的条数（用于 Toast） */
  uploaded: (MigrationCounts & { skipped: number }) | null
  /** 检测到但还没上传的本机旧数据条数；用户可手动触发上传 */
  pending: MigrationCounts | null
  error: string | null
  dismissPending: () => void
  upload: () => Promise<void>
}

interface Options {
  /** 云端数据是否已经加载完成（没加载完无法判断「云端是否为空」） */
  cloudReady: boolean
  /** 云端已有的记录总数 */
  cloudCount: number
  /** 上传完成后刷新三个集合 */
  onImported: () => void
}

export function useLegacyMigration({ cloudReady, cloudCount, onImported }: Options): MigrationState {
  const { status: authStatus, userKey, handleAuthFailure } = useAuth()
  const [status, setStatus] = useState<MigrationStatus>('idle')
  const [uploaded, setUploaded] = useState<(MigrationCounts & { skipped: number }) | null>(null)
  const [pending, setPending] = useState<MigrationCounts | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** 每个账号只自动检查一次 */
  const checkedRef = useRef<string | null>(null)
  const legacyRef = useRef<LegacyData | null>(null)

  const doUpload = useCallback(
    async (legacy: LegacyData) => {
      if (!userKey) return
      setStatus('uploading')
      setError(null)
      try {
        let skipped = 0
        let bikes = 0
        let days = 0

        if (legacy.bikes.length > 0) {
          const r = await api.bulkBikes(legacy.bikes)
          bikes = r.imported
          skipped += r.skipped
        }
        if (legacy.days.length > 0) {
          const r = await api.bulkDays(legacy.days)
          days = r.imported
          skipped += r.skipped
        }
        let rides = 0
        if (legacy.rides.length > 0) {
          const r = await uploadRidesInChunks(legacy.rides)
          rides = r.imported
          skipped += r.skipped
        }

        markMigrated(userKey)
        setUploaded({ rides, bikes, days, skipped })
        setPending(null)
        setStatus('done')
        onImported()
      } catch (err) {
        if (handleAuthFailure(err)) return
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    },
    [userKey, onImported, handleAuthFailure]
  )

  // 自动检查一次：只有在「云端为空」时才直接搬，避免动了用户已经整理好的数据
  useEffect(() => {
    if (authStatus !== 'authenticated' || !userKey || !cloudReady) return
    if (checkedRef.current === userKey) return
    if (isMigrated(userKey)) {
      checkedRef.current = userKey
      setStatus('idle')
      return
    }
    checkedRef.current = userKey
    setStatus('checking')

    void (async () => {
      const legacy = await readLegacyData()
      if (!legacyHasData(legacy)) {
        markMigrated(userKey)
        setStatus('idle')
        return
      }
      legacyRef.current = legacy
      const counts = { rides: legacy.rides.length, bikes: legacy.bikes.length, days: legacy.days.length }
      if (cloudCount === 0) {
        await doUpload(legacy)
      } else {
        // 云端已经有内容了，不擅自合并，交给用户决定
        setPending(counts)
        setStatus('idle')
      }
    })()
  }, [authStatus, userKey, cloudReady, cloudCount, doUpload])

  const upload = useCallback(async () => {
    const legacy = legacyRef.current ?? (await readLegacyData())
    if (!legacyHasData(legacy)) {
      setPending(null)
      return
    }
    legacyRef.current = legacy
    await doUpload(legacy)
  }, [doUpload])

  const dismissPending = useCallback(() => setPending(null), [])

  return { status, uploaded, pending, error, dismissPending, upload }
}
