import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { AiStatus, CoachResult } from '../types'

/**
 * AI 骑行教练的数据层。
 *
 * 三个刻意的设计：
 *
 * 1. **不自动生成**。用户点了才调用 —— 每次调用都是真金白银，而且多数时候
 *    用户只想看评分。把它做成"打开页面就悄悄请求"，是拿钱换一个没人要的惊喜。
 *
 * 2. **先问状态，不可用就整块不渲染**。没配 API Key 时给用户一个点了报错的按钮，
 *    比不显示更糟。状态只问一次（切记录不会重复问，因为 status 与具体记录无关）。
 *
 * 3. **换记录时清空结果**。否则会看到"上一条的复盘配这一条的数据"——
 *    这种错配比没有复盘更误导人。
 *
 * `rideId` 传 null 表示"不该启用"（非管理员账号），此时直接进入 unavailable、不发任何请求。
 */

export type CoachPhase =
  /** 正在问后端：功能是否可用 */
  | 'checking'
  /** 功能不可用（未配置 Key / 已关闭 / 无权限）—— 界面应整块隐藏 */
  | 'unavailable'
  /** 可用但还没生成 */
  | 'idle'
  | 'loading'
  /** 拿到模型生成的复盘 */
  | 'ready'
  /** 模型不可用，已降级为规则引擎建议 */
  | 'fallback'
  /** 请求本身失败（网络不通等），可重试 */
  | 'error'

export interface CoachState {
  phase: CoachPhase
  result: CoachResult | null
  error: string | null
  status: AiStatus | null
  generate: () => Promise<void>
}

export function useCoachReview(rideId: string | null): CoachState {
  const [phase, setPhase] = useState<CoachPhase>('checking')
  const [result, setResult] = useState<CoachResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<AiStatus | null>(null)

  const enabled = rideId !== null

  /** 问一次功能状态。与具体记录无关，所以依赖里不含 rideId */
  useEffect(() => {
    if (!enabled) {
      setPhase('unavailable')
      return
    }
    let cancelled = false
    api
      .aiStatus()
      .then((data) => {
        if (cancelled) return
        setStatus(data)
        setPhase(data.available ? 'idle' : 'unavailable')
      })
      .catch(() => {
        // 问不到（网络问题 / 403）就当不可用 —— 宁可少显示，也不要给一个用不了的入口
        if (!cancelled) setPhase('unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  /** 切记录时清空，避免张冠李戴 */
  useEffect(() => {
    setResult(null)
    setError(null)
    if (enabled && status) setPhase(status.available ? 'idle' : 'unavailable')
  }, [rideId, enabled, status])

  const generate = useCallback(async () => {
    if (!rideId) return
    setPhase('loading')
    setError(null)
    try {
      const data = await api.aiCoach(rideId)
      setResult(data)
      setPhase(data.source === 'model' ? 'ready' : 'fallback')
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请稍后重试')
      setPhase('error')
    }
  }, [rideId])

  return { phase, result, error, status, generate }
}
