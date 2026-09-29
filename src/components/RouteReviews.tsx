import { memo, useMemo } from 'react'
import { MessageSquare, ShieldCheck } from 'lucide-react'
import type { RideRecord } from '../types'

interface Props {
  /** 当前选中记录的路线名(规划路线的目的地) */
  routeName?: string
  /** 全部骑行记录,用于统计自己在该路线上的历史 */
  rides: RideRecord[]
}

/**
 * 路线评价:只展示自己在该路线上的历史骑行统计。
 *
 * ⚠️ **刻意不做任何 UGC 功能**（评分分布、他人反馈、评论区）——
 * 这不是"还没做"，而是不能做：站点为个人主体 ICP 备案，
 * 属非经营性、不能有 UGC。界面上如实说明这一点，
 * 避免给人"以后会有社区功能"的预期 —— 占位本身就会构成"计划提供 UGC"的表象。
 */
function RouteReviews({ routeName, rides }: Props) {
  const stats = useMemo(() => {
    if (!routeName) return null
    const same = rides.filter((r) => r.routeName === routeName)
    const scored = same.filter((r) => r.scores)
    if (same.length === 0) return null
    const avg = scored.length
      ? Math.round((scored.reduce((a, r) => a + (r.scores?.total ?? 0), 0) / scored.length) * 10) / 10
      : null
    const totalKm = Math.round(same.reduce((a, r) => a + (r.distanceKm ?? 0), 0) * 10) / 10
    return { count: same.length, avg, totalKm, last: same[0]?.date ?? null }
  }, [routeName, rides])

  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold tracking-wide text-t2">
        <span className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-accent-sky" aria-hidden="true" />
          路线评价
        </span>
        {routeName && <span className="truncate text-xs font-normal text-t3" title={routeName}>· {routeName}</span>}
      </div>

      {!routeName ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs leading-5 text-t4">
          当前记录没有关联路线 — 用「自动规划路线」生成或导入 GPX 后，这里会显示该路线的评价
        </p>
      ) : (
        <>
          {/* 自己的历史统计 */}
          {stats && (
            <div className="mb-3 flex items-center justify-around gap-2 rounded-lg border border-line bg-fill px-3 py-2">
              <div className="text-center">
                <div className="text-base font-semibold text-t1">{stats.count}</div>
                <div className="text-[10px] text-t4">骑过（次）</div>
              </div>
              <div className="h-8 w-px bg-fill-strong" aria-hidden="true" />
              <div className="text-center">
                <div className="text-base font-semibold text-accent-sky-text">{stats.avg ?? '—'}</div>
                <div className="text-[10px] text-t4">我的平均分</div>
              </div>
              <div className="h-8 w-px bg-fill-strong" aria-hidden="true" />
              <div className="text-center">
                <div className="text-base font-semibold text-t1">{stats.totalKm}</div>
                <div className="text-[10px] text-t4">累计（km）</div>
              </div>
              {stats.last && (
                <>
                  <div className="h-8 w-px bg-fill-strong" aria-hidden="true" />
                  <div className="text-center">
                    <div className="text-base font-semibold text-t1">{stats.last.slice(5)}</div>
                    <div className="text-[10px] text-t4">最近</div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 合规声明：个人备案不能有 UGC —— 如实说明"不提供"，不留"以后开放"的口子 */}
          <p className="flex items-start gap-1.5 rounded-lg border border-dashed border-line px-3 py-2.5 text-[11px] leading-5 text-t4">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>本站为个人骑行记录工具，仅展示本人记录的数据与评价，不含评论等社区功能。</span>
          </p>
        </>
      )}
    </section>
  )
}

/** 该组件重渲染成本较高(图表计算 / 长列表),用 memo 避免父级状态变化时无谓重算 */
export default memo(RouteReviews)
