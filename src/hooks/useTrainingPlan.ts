import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { AiStatus, PlanRequest, PlanResult } from '../types'

/**
 * 训练计划的数据层。
 *
 * 与 AI 复盘（useCoachReview）同一套设计：
 *  1. **不自动生成** —— 每次调用都是真金白银，用户点了才算；
 *  2. **先问状态，不可用就整块不渲染**（非管理员 / 未配 Key）；
 *  3. 与复盘不同的是：它的输入是"目标 + 时间 + 哪一天"，换输入重新生成即可，
 *     没有"换记录要清空"的问题（数据上下文由后端按最新记录组装）。
 */

export type PlanPhase =
  /** 正在问后端：功能是否可用 */
  | 'checking'
  /** 功能不可用（未配置 Key / 已关闭 / 无权限）—— 界面应整块隐藏 */
  | 'unavailable'
  /** 可用但还没生成 */
  | 'idle'
  | 'loading'
  /** 拿到模型生成的计划 */
  | 'ready'
  /** 模型不可用，已降级为规则兜底的保守计划 */
  | 'fallback'
  /** 请求本身失败（网络不通等），可重试 */
  | 'error'

export interface TrainingPlanState {
  phase: PlanPhase
  result: PlanResult | null
  error: string | null
  status: AiStatus | null
  generate: (inputs: PlanRequest) => Promise<void>
}

export function useTrainingPlan(enabled: boolean): TrainingPlanState {
  const [phase, setPhase] = useState<PlanPhase>('checking')
  const [result, setResult] = useState<PlanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<AiStatus | null>(null)

  /** 问一次功能状态。与具体输入无关，所以只问一次 */
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

  const generate = useCallback(async (inputs: PlanRequest) => {
    setPhase('loading')
    setError(null)
    try {
      const data = await api.aiPlan(inputs)
      setResult(data)
      setPhase(data.source === 'model' ? 'ready' : 'fallback')
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请稍后重试')
      setPhase('error')
    }
  }, [])

  return { phase, result, error, status, generate }
}
