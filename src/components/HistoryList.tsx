import { memo, useMemo, useState } from 'react'
import { Bike as BikeIcon, MapPin, Pencil } from 'lucide-react'
import type { Bike, RideRecord } from '../types'
import { SURFACE_LABELS, TRAFFIC_LABELS } from '../types'

interface Props {
  rides: RideRecord[]
  /** 单车列表,用于在记录里显示单车名称 */
  bikes: Bike[]
  selectedId: string | null
  onSelect: (id: string) => void
  onEdit: (record: RideRecord) => void
  onDelete: (id: string) => void
  /** 重命名路线编号 */
  onRename: (id: string, label: string) => void
}

/** 导出 JSON */
function exportJSON(records: RideRecord[]) {
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `骑行记录_${new Date().toISOString().slice(0, 10)}.json`)
}

/** 导出 CSV(扁平化关键字段) */
function exportCSV(records: RideRecord[], bikeNames: Map<string, string>) {
  const header = [
    '路线编号', '日期', '单车', '目的地', '起点位置', '起点所在区', '起点纬度', '起点经度', '城市',
    '距离km', '时长min', '均速kmh', '最高速kmh', '爬升m', '坡度%', '路面', '交通',
    '气温', '风力级', '湿度%', '降水mm', '降雨概率%', 'AQI', 'PM2.5', '综合分', '天气分', '路线分', '降雨指数', '备注',
  ]
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = records.map((r) =>
    [
      r.label ?? '', r.date, (r.bikeId && bikeNames.get(r.bikeId)) || '', r.routeName ?? '', r.startName ?? '',
      r.startDistrict ?? '', r.location?.lat ?? '', r.location?.lon ?? '', r.cityName,
      r.distanceKm, r.durationMin, r.avgSpeed, r.maxSpeed,
      r.route.elevationGain, r.route.avgGrade,
      r.route.surface ? SURFACE_LABELS[r.route.surface] : '',
      r.route.traffic ? TRAFFIC_LABELS[r.route.traffic] : '',
      r.env.temperature, r.env.windLevel, r.env.humidity, r.env.precipitation, r.env.precipitationProbability,
      r.env.aqi, r.env.pm25,
      r.scores?.total, r.scores?.weather, r.scores?.route, r.scores?.rainFactor, r.notes,
    ].map(esc).join(',')
  )
  const csv = '\uFEFF' + header.join(',') + '\n' + rows.join('\n') // BOM 保证 Excel 中文不乱码
  downloadBlob(new Blob([csv], { type: 'text/csv' }), `骑行记录_${new Date().toISOString().slice(0, 10)}.csv`)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 历史记录:筛选、查看、编辑、删除、导出;路线编号可在列表内重命名 */
function HistoryList({ rides, bikes, selectedId, onSelect, onEdit, onDelete, onRename }: Props) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  /** 正在重命名的记录 id 与草稿值 */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const bikeNames = useMemo(() => {
    const map = new Map<string, string>()
    bikes.forEach((b) => map.set(b.id, b.name))
    return map
  }, [bikes])

  const filtered = useMemo(
    () => rides.filter((r) => (!from || r.date >= from) && (!to || r.date <= to)),
    [rides, from, to]
  )

  /** 回车或失焦时提交重命名(先清空 editingId,避免失焦重复提交) */
  const commitRename = (id: string, value: string) => {
    if (editingId !== id) return
    setEditingId(null)
    onRename(id, value.trim())
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label">开始日期</label>
          <input type="date" className="field-input !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="field-label">结束日期</label>
          <input type="date" className="field-input !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {(from || to) && (
          <button type="button" className="btn-ghost" onClick={() => { setFrom(''); setTo('') }}>
            清除筛选
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-ghost" disabled={filtered.length === 0} onClick={() => exportJSON(filtered)}>
            导出 JSON
          </button>
          <button type="button" className="btn-ghost" disabled={filtered.length === 0} onClick={() => exportCSV(filtered, bikeNames)}>
            导出 CSV
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-line text-sm text-t4">
          {rides.length === 0 ? '暂无骑行记录' : '该时间范围内无记录'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="tnum w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-t4">
                <th className="px-3 py-2 font-medium">路线</th>
                <th className="px-3 py-2 font-medium">日期</th>
                <th className="px-3 py-2 font-medium">单车</th>
                <th className="px-3 py-2 font-medium">目的地</th>
                <th className="px-3 py-2 font-medium">起点位置</th>
                <th className="px-3 py-2 font-medium">距离</th>
                <th className="px-3 py-2 font-medium">爬升</th>
                <th className="px-3 py-2 font-medium">天气分</th>
                <th className="px-3 py-2 font-medium">路线分</th>
                <th className="px-3 py-2 font-medium">综合</th>
                <th className="px-3 py-2 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className={`cursor-pointer border-b border-line-soft transition hover:bg-fill ${
                    selectedId === r.id ? 'bg-accent-sky/10' : ''
                  }`}
                  onClick={() => onSelect(r.id)}
                >
                  {/* 路线编号:点击即可重命名 */}
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    {editingId === r.id ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => commitRename(r.id, draft)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(r.id, draft)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        className="w-20 rounded border border-accent-sky/50 bg-surface-2 px-1.5 py-0.5 text-xs text-t1 outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        title="点击重命名"
                        onClick={() => {
                          setEditingId(r.id)
                          setDraft(r.label ?? '')
                        }}
                        className="group inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-t1 hover:bg-fill-strong"
                      >
                        <span className="font-medium">{r.label || '—'}</span>
                        <Pencil className="h-3 w-3 text-t4 opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{r.date}</td>
                  <td className="max-w-[130px] truncate px-3 py-2.5 text-t2">
                    {r.bikeId && bikeNames.has(r.bikeId) ? (
                      <span className="inline-flex items-center gap-1">
                        <BikeIcon className="h-3 w-3 shrink-0 text-accent-sky" aria-hidden="true" />
                        {bikeNames.get(r.bikeId)}
                      </span>
                    ) : (
                      <span className="text-t5">—</span>
                    )}
                  </td>
                  <td className="max-w-[170px] truncate px-3 py-2.5 text-t2" title={r.routeName ?? undefined}>
                    {r.routeName || <span className="text-t5">—</span>}
                  </td>
                  <td
                    className="max-w-[180px] truncate px-3 py-2.5 text-t3"
                    title={
                      r.location
                        ? `${r.startName || '起点'}\n坐标：${r.location.lat.toFixed(4)}, ${r.location.lon.toFixed(4)}`
                        : r.startName || undefined
                    }
                  >
                    {r.startDistrict || r.startName ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3 shrink-0 text-accent-amber" aria-hidden="true" />
                        {r.startDistrict || r.startName}
                      </span>
                    ) : (
                      <span className="text-t5">{r.cityName}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.distanceKm ? (
                      `${r.distanceKm} km`
                    ) : r.checkIn ? (
                      <span className="rounded bg-accent-sky/15 px-1.5 py-0.5 text-[10px] text-accent-sky-text" title="由今日骑行打卡生成，可编辑补充距离等详细数据">
                        打卡
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-t3">{r.route.elevationGain ?? '—'} m</td>
                  <td className="px-3 py-2.5">
                    <ScoreDot value={r.scores?.weather} />
                  </td>
                  <td className="px-3 py-2.5">
                    <ScoreDot value={r.scores?.route} amber />
                  </td>
                  <td className="px-3 py-2.5 font-semibold">
                    <span className={scoreClass(r.scores?.total)}>{r.scores?.total ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">
                      <button type="button" className="rounded-md px-2 py-1 text-xs text-accent-sky-text hover:bg-accent-sky/10" onClick={() => onEdit(r)}>
                        编辑
                      </button>
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-xs text-accent-red-text hover:bg-accent-red/10"
                        onClick={() => {
                          if (confirm(`删除 ${r.date} 的骑行记录？`)) onDelete(r.id)
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function scoreClass(value?: number): string {
  if (value == null) return 'text-t4'
  if (value >= 85) return 'text-accent-emerald'
  if (value >= 70) return 'text-accent-sky'
  if (value >= 50) return 'text-accent-amber'
  return 'text-accent-red'
}

function ScoreDot({ value, amber }: { value?: number; amber?: boolean }) {
  if (value == null) return <span className="text-t5">—</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-8 overflow-hidden rounded-full bg-fill-strong`}>
        <span
          className={`block h-full rounded-full ${amber ? 'bg-accent-amber/80' : 'bg-accent-emerald/80'}`}
          style={{ width: `${value}%` }}
        />
      </span>
      {value}
    </span>
  )
}

/** 该组件重渲染成本较高(图表计算 / 长列表),用 memo 避免父级状态变化时无谓重算 */
export default memo(HistoryList)
