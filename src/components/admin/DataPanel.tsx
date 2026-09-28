import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { adminApi, type AdminRide } from '../../api/client'
import {
  DANGER_BTN,
  EmptyState,
  ErrorNote,
  Loading,
  OkNote,
  Panel,
  StatCard,
  useAsync,
  useFlash,
} from './ui'

const PAGE_SIZE = 30

const SMALL_BTN =
  'rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-t2 transition hover:bg-fill disabled:opacity-50'

/** 数据浏览与统计：跨用户看记录（列表同样不带轨迹，与用户端约定一致） */
export default function DataPanel() {
  const [userId, setUserId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [city, setCity] = useState('')
  const [filters, setFilters] = useState<{ userId?: number; from?: string; to?: string; city?: string }>({})
  const [page, setPage] = useState(0)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const rides = useAsync(
    () => adminApi.rides({ ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [filters, page]
  )
  const stats = useAsync(() => adminApi.stats(), [])
  const { flash, show } = useFlash()

  function applyFilters() {
    setPage(0)
    setFilters({
      userId: userId.trim() === '' ? undefined : Number(userId),
      from: from || undefined,
      to: to || undefined,
      city: city.trim() || undefined,
    })
  }

  async function removeRide(ride: AdminRide) {
    try {
      await adminApi.deleteRide(ride.userId, ride.id)
      show('ok', `已删除 ${ride.date} 的记录`)
      setPendingDelete(null)
      rides.reload()
      stats.reload()
    } catch (err) {
      show('error', err instanceof Error ? err.message : '删除失败')
    }
  }

  const total = rides.data?.total ?? 0
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)

  return (
    <div className="space-y-4">
      {flash && (flash.type === 'ok' ? <OkNote>{flash.text}</OkNote> : <ErrorNote>{flash.text}</ErrorNote>)}

      {stats.data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="记录总数" value={stats.data.total} />
          <StatCard label="含轨迹" value={stats.data.withTrack} hint="其余是手动录入、没有 GPS 轨迹" />
          <StatCard
            label="平均距离"
            value={stats.data.avgDistanceKm == null ? '—' : `${stats.data.avgDistanceKm.toFixed(1)} km`}
          />
          <StatCard label="填写过城市" value={stats.data.byCity.length} hint="按城市归类的结果数" />
        </div>
      )}

      {stats.data && stats.data.byCity.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="按城市" description="最多显示前 15 个">
            <Bars items={stats.data.byCity.map((c) => ({ label: c.city, value: c.count }))} />
          </Panel>
          <Panel title="按月份" description="最近 12 个月（按骑行日期）">
            <Bars items={[...stats.data.byMonth].reverse().map((m) => ({ label: m.month, value: m.count }))} />
          </Panel>
        </div>
      )}

      <Panel
        title="记录浏览"
        description="跨账号查看。列表刻意不带 GPS 轨迹 —— 一次列出几十条轨迹会让响应变成几十 MB。"
        actions={
          <button type="button" className={SMALL_BTN} onClick={rides.reload} disabled={rides.loading}>
            <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden="true" />
            刷新
          </button>
        }
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="field-input"
            placeholder="账号 ID（数字）"
            value={userId}
            onChange={(e) => setUserId(e.target.value.replace(/\D/g, ''))}
          />
          <input className="field-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="开始日期" />
          <input className="field-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} title="结束日期" />
          <input className="field-input" placeholder="城市关键字" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="mb-3 flex gap-2">
          <button type="button" className="btn-primary" onClick={applyFilters}>
            筛选
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setUserId('')
              setFrom('')
              setTo('')
              setCity('')
              setFilters({})
              setPage(0)
            }}
          >
            重置
          </button>
        </div>

        {rides.loading && <Loading />}
        {rides.error && !rides.loading && <ErrorNote>加载失败：{rides.error}</ErrorNote>}

        {!rides.loading && !rides.error && rides.data && (
          <>
            {rides.data.items.length === 0 ? (
              <EmptyState>没有匹配的记录</EmptyState>
            ) : (
              <ul className="space-y-2">
                {rides.data.items.map((ride) => {
                  const key = `${ride.userId}/${ride.id}`
                  return (
                    <li key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-fill/30 px-3 py-2">
                      <div className="min-w-0 text-[11px]">
                        <p className="text-t1">
                          {ride.date}
                          {ride.hasTrack ? <span className="ml-2 text-t5">含轨迹</span> : <span className="ml-2 text-t5">无轨迹</span>}
                        </p>
                        <p className="mt-0.5 truncate text-t4">
                          {ride.userEmail} · #{ride.userId} · {ride.distanceKm == null ? '距离未填' : `${ride.distanceKm} km`}
                          {ride.cityName ? ` · ${ride.cityName}` : ''}
                        </p>
                      </div>
                      {pendingDelete === key ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={DANGER_BTN}
                            disabled={pendingDelete !== key}
                            onClick={() => void removeRide(ride)}
                          >
                            确认删除
                          </button>
                          <button type="button" className={SMALL_BTN} onClick={() => setPendingDelete(null)}>
                            取消
                          </button>
                        </div>
                      ) : (
                        <button type="button" className={DANGER_BTN} onClick={() => setPendingDelete(key)}>
                          删除
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {total > PAGE_SIZE && (
              <div className="mt-3 flex items-center justify-between text-[11px] text-t5">
                <span>共 {total} 条</span>
                <div className="flex items-center gap-2">
                  <button type="button" className={SMALL_BTN} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    上一页
                  </button>
                  <span>
                    第 {page + 1} / {maxPage + 1} 页
                  </span>
                  <button type="button" className={SMALL_BTN} disabled={page >= maxPage} onClick={() => setPage((p) => p + 1)}>
                    下一页
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  )
}

function Bars({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((item) => item.value))
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-[11px]">
          <span className="w-20 shrink-0 truncate text-t4">{item.label}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-fill">
            <span
              className="block h-2 rounded-full bg-accent-sky/70"
              style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }}
            />
          </span>
          <span className="w-8 shrink-0 text-right text-t3">{item.value}</span>
        </li>
      ))}
    </ul>
  )
}
