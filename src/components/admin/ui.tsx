import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 站长控制台的共享零件。
 *
 * 后台每个面板都要做同一件事：「拉数据 → 显示加载/错误 → 能重试」，
 * 所以这里把这段逻辑和几个展示件抽出来，面板本身只关心内容。
 */

export function Loading({ label = '加载中…' }: { label?: string }) {
  return <p className="py-8 text-center text-xs text-t4">{label}</p>
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-[11px] leading-5 text-accent-red-text">
      {children}
    </p>
  )
}

export function OkNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-accent-emerald/30 bg-accent-emerald/10 px-3 py-2 text-[11px] leading-5 text-accent-emerald-text">
      {children}
    </p>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-line bg-fill/40 px-3 py-6 text-center text-xs text-t4">{children}</p>
  )
}

export function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="card">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-t1">{title}</h2>
          {description && <p className="mt-1 text-[11px] leading-5 text-t4">{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card">
      <p className="text-[11px] text-t4">{label}</p>
      <p className="mt-1 text-xl font-semibold text-t1">{value}</p>
      {hint && <p className="mt-1 text-[11px] leading-4 text-t5">{hint}</p>}
    </div>
  )
}

/** 危险操作按钮：视觉上与普通按钮拉开距离，减少误点 */
export const DANGER_BTN =
  'rounded-lg border border-accent-red/40 px-3 py-1.5 text-[11px] text-accent-red-text transition hover:bg-accent-red/10'

/** 审计动作的中文名，概览与审计页都要显示 */
export const ACTION_LABEL: Record<string, string> = {
  'user.disable': '停用账号',
  'user.enable': '启用账号',
  'user.reset_password': '重置密码',
  'user.delete': '删除账号',
  'setting.update': '修改设置',
  'ride.delete': '删除记录',
  'backup.create': '创建备份',
  'backup.delete': '删除备份',
  'audit.prune': '清理审计日志',
  'invite.create': '新建邀请码',
  'invite.delete': '删除邀请码',
}

/* ---------------- 格式化 ---------------- */

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function formatSize(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(2)} GB`
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb} KB`
}

export function formatUptime(sec: number): string {
  const days = Math.floor(sec / 86400)
  const hours = Math.floor((sec % 86400) / 3600)
  const minutes = Math.floor((sec % 3600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return `${minutes} 分钟`
}

/* ---------------- 取数 ---------------- */

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * 「拉一次数据 + 能重试」的最小实现。
 * loader 放在 ref 里，所以调用方不必费心去 useCallback 包一层也不会重复请求。
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const result = await loaderRef.current()
        if (alive) setData(result)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { data, loading, error, reload }
}

/** 一次性提示（"密码已重置"这类），几秒后自动消失 */
export function useFlash(ms = 6000) {  const [flash, setFlash] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback(
    (type: 'ok' | 'error', text: string) => {
      setFlash({ type, text })
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setFlash(null), ms)
    },
    [ms]
  )

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  return { flash, show, clear: () => setFlash(null) }
}
