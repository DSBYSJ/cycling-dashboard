import { memo } from 'react'
import type { RideRecord } from '../types'
import { rainLevelLabel } from '../utils/scoring'

/** 评分卡片:综合分、分项、降雨指数、文字评价与建议 */
function ScoreCard({ record }: { record: RideRecord }) {
  const scores = record.scores
  if (!scores) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-t4">暂无评分数据</div>
    )
  }

  const rainLabel = rainLevelLabel(scores.rainFactor, record.env.precipitation, record.env.precipitationProbability)
  /** 评分档位:环与数字同档同色,配色由 index.css 的主题变量驱动 */
  const band = scores.total >= 85 ? 'excellent' : scores.total >= 70 ? 'good' : scores.total >= 50 ? 'fair' : 'poor'
  const scoreColor = `score-text-${band}`
  const ringClass = `score-ring-${band}`

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-5">
        {/* 综合评分环形 */}
        <div className="relative h-28 w-28 shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" className="chart-grid" strokeWidth="10" />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              className={ringClass}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(scores.total / 100) * 2 * Math.PI * 42} ${2 * Math.PI * 42}`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`tnum text-3xl font-bold ${scoreColor}`}>{scores.total}</span>
            <span className="text-[10px] text-t4">综合评分</span>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex gap-2">
            <SubScore label="天气 60%" value={scores.weather} color="bg-accent-emerald/80" />
            <SubScore label="路线 40%" value={scores.route} color="bg-accent-amber/80" />
          </div>
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs leading-5 text-t2">
            <span className="text-accent-sky-text">降雨指数：{scores.rainFactor}</span>({rainLabel})
            {(record.env.precipitation != null || record.env.precipitationProbability != null) && (
              <span className="text-t4">
                {' '}
                · 降水 {record.env.precipitation ?? '—'}mm · 概率 {record.env.precipitationProbability ?? '—'}%
              </span>
            )}
          </div>
        </div>
      </div>

      <p className="rounded-lg border border-line bg-surface-2/70 px-4 py-3 text-sm leading-6 text-t1">{record.comment}</p>

      {record.suggestions.length > 0 && (
        <ul className="space-y-1.5">
          {record.suggestions.map((s, i) => (
            <li key={i} className="flex gap-2 text-xs leading-5 text-t3">
              <span className="text-accent-amber">▲</span>
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SubScore({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="whitespace-nowrap text-[10px] text-t4">{label}</span>
        <span className="text-lg font-semibold text-t1">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill-strong">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

/** 该组件重渲染成本较高(图表计算 / 长列表),用 memo 避免父级状态变化时无谓重算 */
export default memo(ScoreCard)
