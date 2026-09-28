import type { Bike, DayCheckIn, RideRecord } from '../../types'
import type { BikeWithStatus } from '../../utils/tire'
import type { ImportSummary } from '../../utils/backup'
import TrendChart from '../TrendChart'
import TripAdvice from '../TripAdvice'
import SpeedChart from '../SpeedChart'
import ElevationChart from '../ElevationChart'
import MapView from '../MapView'
import ScoreRadar from '../ScoreRadar'
import HistoryList from '../HistoryList'
import DataBackup from '../DataBackup'

interface Props {
  rides: RideRecord[]
  bikes: BikeWithStatus[]
  /** 备份导出用的原始单车数据(不含统计字段) */
  rawBikes: Bike[]
  days: DayCheckIn[]
  selected: RideRecord | null
  selectedId: string | null
  onSelect: (id: string) => void
  onEdit: (record: RideRecord) => void
  onDelete: (id: string) => void
  onRename: (id: string, label: string) => void
  onImport: (summary: ImportSummary) => Promise<{ rides: number; bikes: number; days: number }>
  /** 出行建议用的常用地点（最近一次带坐标的记录）；没有记录时为 null */
  adviceLocation: { lat: number; lon: number } | null
}

/** 「看板」分页:评分趋势 + 速度/海拔曲线 + 轨迹地图 + 评分雷达 + 历史记录 + 数据备份 */
export default function DashboardTab({
  rides,
  bikes,
  rawBikes,
  days,
  selected,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onRename,
  onImport,
  adviceLocation,
}: Props) {
  return (
    <>
      <TripAdvice location={adviceLocation} />

      <section className="card">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-wide text-t2">
          📈 评分趋势（最近 10 次）
        </div>
        <TrendChart rides={rides} />
      </section>

      {selected ? (
        <>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <section className="card">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-wide text-t2">
                ⚡ 速度曲线
                <span className="text-xs font-normal text-t4">{selected.date}</span>
              </div>
              <SpeedChart data={selected.speedSeries} />
            </section>
            <section className="card">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-wide text-t2">⛰️ 海拔曲线</div>
              <ElevationChart track={selected.track} />
            </section>
          </div>

          {/* 轨迹地图与评分雷达并排(高度接近,雷达限制宽度避免撑满) */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {selected.track.length >= 2 && (
              <section className="card">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-wide text-t2">
                  🗺️ 骑行轨迹 · {selected.date}
                </div>
                <MapView track={selected.track} />
              </section>
            )}

            {selected.scores && (
              <section className="card">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-wide text-t2">
                  🎯 评分雷达
                  <span className="text-xs font-normal text-t4">
                    天气 {selected.scores.weather} · 路线 {selected.scores.route}
                  </span>
                </div>
                <div className="mx-auto w-full max-w-[320px]">
                  <ScoreRadar weather={selected.scores.weather} route={selected.scores.route} />
                </div>
              </section>
            )}
          </div>
        </>
      ) : (
        <section className="card">
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-t4">
            <p>还没有骑行记录</p>
            <p className="text-xs">保存记录后，这里会显示速度曲线、海拔曲线与骑行轨迹地图</p>
          </div>
        </section>
      )}

      {/* 历史记录(并入看板):筛选、编辑、重命名、导出 */}
      <section className="card">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm font-semibold tracking-wide text-t2">
          <span>🗂️ 历史记录</span>
          {rides.length > 0 && <span className="text-xs font-normal text-t4">共 {rides.length} 条</span>}
        </div>
        <HistoryList
          rides={rides}
          bikes={bikes}
          selectedId={selectedId}
          onSelect={onSelect}
          onEdit={onEdit}
          onDelete={onDelete}
          onRename={onRename}
        />
      </section>

      {/* 数据备份与恢复 */}
      <DataBackup rides={rides} bikes={rawBikes} days={days} onImport={onImport} />
    </>
  )
}
