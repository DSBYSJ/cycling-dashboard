import { memo } from 'react'
import { RefreshCw, Rocket } from 'lucide-react'
import { useForecast } from '../hooks/useForecast'
import { windowLabel } from '../utils/forecast'

interface Props {
  /** 常用地点（取最近一次带坐标的骑行记录）；为 null 时引导用户先记录一次 */
  location: { lat: number; lon: number } | null
}

/** 分数 → 语义色（与评分卡共用同一套档位配色） */
function scoreClass(score: number): string {
  if (score >= 85) return 'score-text-excellent'
  if (score >= 70) return 'score-text-good'
  if (score >= 50) return 'score-text-fair'
  return 'score-text-poor'
}

/**
 * 出行建议：把「未来 7 天」的逐小时预报按同一套评分口径过一遍，
 * 找出每天最适合出门的 2 小时窗口。
 *
 * 这是把看板从「记录仪」变成「决策工具」的那一步 ——
 * 之前只能事后知道那天骑得值不值，现在出门前就知道该挑哪个时段。
 */
function TripAdvice({ location }: Props) {
  const { loading, error, best, days, aqiAvailable, refresh } = useForecast(location)

  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold tracking-wide text-t2">
        <span className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-accent-sky" aria-hidden="true" />
          出行建议
        </span>
        <span className="text-xs font-normal text-t4">未来 7 天 · 与骑行评分同一口径</span>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || !location}
          title="重新获取预报"
          aria-label="重新获取预报"
          className="ml-auto flex items-center gap-1 rounded-full border border-line bg-fill px-2 py-0.5 text-[11px] font-normal text-t3 transition hover:bg-fill-strong disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          刷新
        </button>
      </div>

      {!location ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs leading-5 text-t4">
          先保存一条带位置的骑行记录，这里会基于你的常去地点给出未来一周的出门建议
        </p>
      ) : error ? (
        <p className="rounded-lg border border-accent-amber/30 bg-accent-amber/10 px-3 py-3 text-xs leading-5 text-accent-amber-text">
          {error}
        </p>
      ) : loading && !days.length ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-t4">
          正在获取未来天气…
        </p>
      ) : !days.length ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-t4">
          没有取到可用的预报数据
        </p>
      ) : (
        <>
          {best && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-fill px-3 py-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-t4">最值得出门</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-t1">
                  {days.find((d) => d.date === best.date)?.label ?? best.date} {windowLabel(best)}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-t4">
                  {best.reason}
                  {best.temperature != null && ` · 气温 ${best.temperature}℃`}
                  {` · 降水 ${best.precipitation}mm`}
                  {best.maxProbability > 0 && ` · 降雨概率 ${best.maxProbability}%`}
                </div>
              </div>
              <div className={`shrink-0 text-2xl font-bold ${scoreClass(best.score)}`}>{best.score}</div>
            </div>
          )}

          <ul className="mt-2">
            {days.map((day) => (
              <li
                key={day.date}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition hover:bg-fill"
              >
                <span className="w-9 shrink-0 text-t3">{day.label}</span>
                {day.window ? (
                  <>
                    <span className="w-[88px] shrink-0 tabular-nums text-t4">{windowLabel(day.window)}</span>
                    <span className={`w-7 shrink-0 text-right font-semibold ${scoreClass(day.window.score)}`}>
                      {day.window.score}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-t4">{day.window.reason}</span>
                    <span className="shrink-0 tabular-nums text-t5">
                      {day.window.temperature != null ? `${day.window.temperature}℃` : '—'}
                    </span>
                  </>
                ) : (
                  <span className="text-t5">数据不足</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-3 text-[10px] leading-4 text-t5">
        数据来源：Open-Meteo 天气预报{aqiAvailable ? '与空气质量' : ''}（逐小时）。
        {!aqiAvailable && location && ' 空气质量预报暂不可用，本次评分不含该项。'}
        分数衡量的是天气适宜度，不含路线质量 —— 与历史记录的评分口径一致。
      </p>
    </section>
  )
}

export default memo(TripAdvice)
