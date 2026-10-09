import { memo, useMemo } from 'react'
import type { TrackPoint } from '../types'
import { downsample, extent, niceTicks, scaleLinear } from '../utils/chartHelpers'
import { monotoneAreaPath, monotonePath } from '../utils/chartHelpers'
import { haversine } from '../utils/gpxParser'

interface Props {
  track: TrackPoint[]
}

const W = 640
const H = 220
const PAD = { top: 18, right: 14, bottom: 26, left: 44 }

/** 海拔曲线:手写 SVG 面积图(单调插值,曲线不会溢出图表区域) */
function ElevationChart({ track }: Props) {
  const chart = useMemo(() => {
    const withEle = track.filter((p) => p.ele != null && Number.isFinite(p.ele))
    if (withEle.length < 2) return null
    let cumulative = 0
    let prev: TrackPoint | null = null
    const series = withEle.map((p) => {
      if (prev) cumulative += haversine(prev.lat, prev.lon, p.lat, p.lon)
      prev = p
      return { distanceKm: cumulative / 1000, ele: p.ele as number }
    })
    const sampled = downsample(series, 240)
    const [x0, x1] = extent(sampled.map((d) => d.distanceKm))
    const [eleMin, eleMax] = extent(sampled.map((d) => d.ele))

    // 纵轴范围:贴合实际海拔区间并留一点余量,不用从 0 起(海拔曲线看的是起伏)
    const span = Math.max(10, eleMax - eleMin)
    const pad = Math.max(2, span * 0.12)
    const domainMin = eleMin - pad
    const domainMax = eleMax + pad
    // 比例尺用「数据范围」而非「第一个刻度」,否则低于首个刻度的海拔会被压平在图底
    const x = scaleLinear([x0, x1], [PAD.left, W - PAD.right])
    const y = scaleLinear([domainMin, domainMax], [H - PAD.bottom, PAD.top])
    // 刻度只用于画网格线与标注,过滤掉落在范围外的
    const yTicks = niceTicks(domainMin, domainMax, 4).filter((t) => t >= domainMin && t <= domainMax)
    if (yTicks.length < 2) return null

    const coords = sampled.map((d) => [x(d.distanceKm), y(d.ele)] as [number, number])
    return {
      coords,
      xTicks: niceTicks(x0, x1, 6),
      yTicks,
      x,
      y,
      baseline: H - PAD.bottom,
      eleMin,
      eleMax,
      gain: Math.round(eleMax - eleMin),
    }
  }, [track])

  if (!chart) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-t4">
        暂无海拔数据 — 导入含海拔的 GPX 或使用地图绘制（自动采样）后生成
      </div>
    )
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="海拔曲线">
      {chart.yTicks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={chart.y(t)} y2={chart.y(t)} className="chart-grid" />
          <text x={PAD.left - 6} y={chart.y(t)} textAnchor="end" dominantBaseline="middle" style={{ fontSize: 10 }} className="fill-t4">
            {Math.round(t)}
          </text>
        </g>
      ))}
      {chart.xTicks.map((t) => (
        <text key={t} x={chart.x(t)} y={H - PAD.bottom + 14} textAnchor="middle" style={{ fontSize: 10 }} className="fill-t4">
          {t}
        </text>
      ))}
      {/* 最高/最低海拔参考线 */}
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={chart.y(chart.eleMax)}
        y2={chart.y(chart.eleMax)}
        className="chart-elevation-ref"
        strokeDasharray="4 4"
      />
      <text x={W - PAD.right} y={chart.y(chart.eleMax) - 4} textAnchor="end" style={{ fontSize: 10 }} className="fill-accent-amber">
        最高 {Math.round(chart.eleMax)} m
      </text>
      {/* 海拔面积:描边与填充共用同一条单调曲线,不会错位 */}
      <path d={monotoneAreaPath(chart.coords, chart.baseline)} fill="url(#eleGradient)" stroke="none" className="chart-fade-in" />
      <path d={monotonePath(chart.coords)} fill="none" className="chart-elevation chart-draw" pathLength={1} strokeWidth="2" strokeLinecap="round" />
      <defs>
        <linearGradient id="eleGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="chart-ele-area-top" />
          <stop offset="100%" className="chart-ele-area-bottom" />
        </linearGradient>
      </defs>
      <text x={PAD.left + 4} y={PAD.top - 4} style={{ fontSize: 10 }} className="fill-t4">
        m · 区间 {Math.round(chart.eleMin)}–{Math.round(chart.eleMax)} m(落差 {chart.gain} m)
      </text>
    </svg>
  )
}

/** 该组件重渲染成本较高(图表计算 / 长列表),用 memo 避免父级状态变化时无谓重算 */
export default memo(ElevationChart)
