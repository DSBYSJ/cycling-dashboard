import { memo, useMemo } from 'react'
import { BarChart3 } from 'lucide-react'
import type { RideRecord } from '../types'
import { scaleLinear } from '../utils/chartHelpers'
import { useCountUp } from '../hooks/useCountUp'

interface Props {
  rides: RideRecord[]
}

const WEEKS = 6

function dayISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 近 30 天数据概览:骑行次数、里程、时长、爬升、平均分 + 近 6 周里程迷你柱图 */
function StatsOverview({ rides }: Props) {
  const stats = useMemo(() => {
    const today = new Date()
    const since = new Date(today)
    since.setDate(since.getDate() - 29)
    const sinceISO = dayISO(since)

    const recent = rides.filter((r) => r.date >= sinceISO)
    const totals = recent.reduce(
      (acc, r) => {
        acc.km += r.distanceKm ?? 0
        acc.min += r.durationMin ?? 0
        acc.gain += r.route.elevationGain ?? 0
        if (r.scores) {
          acc.scoreSum += r.scores.total
          acc.scoreCount += 1
        }
        return acc
      },
      { km: 0, min: 0, gain: 0, scoreSum: 0, scoreCount: 0 }
    )

    // 近 6 周(含本周)每周里程
    const weeks: { label: string; km: number }[] = []
    for (let i = WEEKS - 1; i >= 0; i--) {
      const end = new Date(today)
      end.setDate(end.getDate() - i * 7)
      const start = new Date(end)
      start.setDate(start.getDate() - 6)
      const startISO = dayISO(start)
      const endISO = dayISO(end)
      const km = rides
        .filter((r) => r.date >= startISO && r.date <= endISO)
        .reduce((a, r) => a + (r.distanceKm ?? 0), 0)
      weeks.push({ label: i === 0 ? '本周' : `${i}周前`, km: Math.round(km * 10) / 10 })
    }

    const maxKm = Math.max(1, ...weeks.map((w) => w.km))
    return {
      count: recent.length,
      km: Math.round(totals.km * 10) / 10,
      hours: Math.round((totals.min / 60) * 10) / 10,
      gain: Math.round(totals.gain),
      avgScore: totals.scoreCount ? Math.round((totals.scoreSum / totals.scoreCount) * 10) / 10 : null,
      weeks,
      maxKm,
    }
  }, [rides])

  const barH = 34
  const chartW = 240
  const x = scaleLinear([0, WEEKS - 1], [14, chartW - 14])

  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold tracking-wide text-t2">
        <span className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-accent-emerald" aria-hidden="true" />
          近 30 天概览
        </span>
        <span className="text-xs font-normal text-t4">共 {stats.count} 次骑行</span>
      </div>

      {stats.count === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-t4">
          最近 30 天还没有骑行记录
        </p>
      ) : (
        <>
          <div className="flex items-center justify-around gap-2 rounded-lg border border-line bg-fill px-2 py-2">
            <Metric value={stats.km} unit="km" label="总里程" accent />
            <Divider />
            <Metric value={stats.hours} unit="h" label="总时长" />
            <Divider />
            <Metric value={stats.gain} unit="m" label="总爬升" />
            <Divider />
            <Metric value={stats.avgScore ?? '—'} unit="" label="平均分" accent />
          </div>

          {/* 近 6 周里程 */}
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[10px] text-t4">
              <span>近 6 周里程</span>
              <span>单周最高 {stats.maxKm} km</span>
            </div>
            <svg viewBox={`0 0 ${chartW} ${barH + 14}`} className="w-full" role="img" aria-label="近 6 周里程">
              {stats.weeks.map((w, i) => {
                const h = Math.max(2, (w.km / stats.maxKm) * barH)
                const bx = x(i) - 9
                return (
                  <g key={w.label}>
                    <rect x={bx} y={barH - h} width="18" height={h} rx="3" fill="rgba(52,211,153,0.75)" />
                    <text x={x(i)} y={barH + 11} textAnchor="middle" style={{ fontSize: 8 }} className="fill-t4">
                      {w.label}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>
        </>
      )}
    </section>
  )
}

function Metric({ value, unit, label, accent }: { value: number | string; unit: string; label: string; accent?: boolean }) {
  // 数字型指标滚动到目标值（字符串指标如"12 / 8"直接显示）
  const animated = useCountUp(typeof value === 'number' ? value : 0)
  const shown = typeof value === 'number' ? animated : value
  return (
    <div className="text-center">
      <div className={`tnum text-base font-semibold ${accent ? 'text-accent-emerald' : 'text-t1'}`}>
        {shown}
        {unit && <span className="ml-0.5 text-[10px] font-normal text-t4">{unit}</span>}
      </div>
      <div className="text-[10px] text-t4">{label}</div>
    </div>
  )
}

function Divider() {
  return <div className="h-7 w-px bg-fill-strong" aria-hidden="true" />
}

/** 该组件重渲染成本较高(图表计算 / 长列表),用 memo 避免父级状态变化时无谓重算 */
export default memo(StatsOverview)
