import { memo, useMemo } from 'react'
import { downsample, extent, monotonePath, niceTicks, scaleLinear } from '../utils/chartHelpers'

interface Props {
  data: { distanceKm: number; speed: number }[]
}

const W = 640
const H = 220
const PAD = { top: 14, right: 14, bottom: 26, left: 38 }

/** 速度曲线:手写 SVG 折线图(仅展示,不参与评分) */
function SpeedChart({ data }: Props) {
  const chart = useMemo(() => {
    // 无时间戳时所有速度为 0,此时没有可展示的速度信息
    const pts = data.filter((d) => Number.isFinite(d.speed) && d.speed > 0)
    if (pts.length < 2) return null
    const sampled = downsample(pts, 240)
    const [x0, x1] = extent(sampled.map((d) => d.distanceKm))
    const [y0raw, y1raw] = extent(sampled.map((d) => d.speed))
    const yPad = Math.max(2, (y1raw - y0raw) * 0.08)
    // 比例尺用「数据范围 ± 余量」,刻度仅用于网格线,避免最低值被压平在图底
    const domainMin = Math.max(0, y0raw - yPad)
    const domainMax = y1raw + yPad
    const x = scaleLinear([x0, x1], [PAD.left, W - PAD.right])
    const y = scaleLinear([domainMin, domainMax], [H - PAD.bottom, PAD.top])
    const yTicks = niceTicks(domainMin, domainMax, 4).filter((t) => t >= domainMin && t <= domainMax)
    if (yTicks.length < 2) return null
    const coords = sampled.map((d) => [x(d.distanceKm), y(d.speed)] as [number, number])
    const avg = sampled.reduce((a, b) => a + b.speed, 0) / sampled.length
    return { coords, xTicks: niceTicks(x0, x1, 6), yTicks, x, y, avg }
  }, [data])

  if (!chart) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-t4">
        暂无速度数据 — 导入带时间戳的 GPX 后自动生成
      </div>
    )
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="速度曲线">
      {/* 网格与 Y 轴 */}
      {chart.yTicks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={chart.y(t)} y2={chart.y(t)} className="chart-grid" />
          <text x={PAD.left - 6} y={chart.y(t)} textAnchor="end" dominantBaseline="middle" style={{ fontSize: 10 }} className="fill-t4">
            {t}
          </text>
        </g>
      ))}
      {/* X 轴(距离 km) */}
      {chart.xTicks.map((t) => (
        <text key={t} x={chart.x(t)} y={H - PAD.bottom + 14} textAnchor="middle" style={{ fontSize: 10 }} className="fill-t4">
          {t}
        </text>
      ))}
      {/* 平均速度参考线 */}
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={chart.y(chart.avg)}
        y2={chart.y(chart.avg)}
        className="chart-avg-ref"
        strokeDasharray="4 4"
      />
      <text x={W - PAD.right} y={chart.y(chart.avg) - 5} textAnchor="end" style={{ fontSize: 10 }} className="fill-accent-amber">
        均速 {chart.avg.toFixed(1)} km/h
      </text>
      {/* 速度曲线:单调插值,陡变处不会冲出图表区域 */}
      <path d={monotonePath(chart.coords)} fill="none" className="chart-speed chart-draw" pathLength={1} strokeWidth="2" strokeLinecap="round" />
      {chart.coords.length > 0 && (
        <circle cx={chart.coords[chart.coords.length - 1][0]} cy={chart.coords[chart.coords.length - 1][1]} r="3" className="chart-dot-speed" />
      )}
      <text x={PAD.left + 4} y={PAD.top + 2} style={{ fontSize: 10 }} className="fill-t4">
        km/h
      </text>
    </svg>
  )
}

/** 该组件重渲染成本较高(图表计算 / 长列表),用 memo 避免父级状态变化时无谓重算 */
export default memo(SpeedChart)
