import { Bike as BikeIcon, MapPin } from 'lucide-react'
import type { DayCheckIn, RideRecord } from '../../types'
import type { BikeWithStatus } from '../../utils/tire'
import RideForm from '../RideForm'
import RideCheckIn from '../RideCheckIn'
import ScoreCard from '../ScoreCard'
import CoachReviewCard from '../CoachReviewCard'
import RouteReviews from '../RouteReviews'
import StatsOverview from '../StatsOverview'
import MaintenanceAlerts from '../MaintenanceAlerts'

interface Props {
  rides: RideRecord[]
  bikes: BikeWithStatus[]
  days: DayCheckIn[]
  /** 当前选中的记录(右侧评分卡片的数据源) */
  selected: RideRecord | null
  selectedBikeName: string | null
  /** 正在编辑的记录;为 null 表示新建 */
  editing: RideRecord | null
  onCancelEdit: () => void
  onSave: (record: RideRecord) => void
  onEdit: (record: RideRecord) => void
  onCheckIn: (input: { rode: boolean; bikeId?: string; distanceKm?: number }) => Promise<string | null>
  onClearToday: () => Promise<void>
  onManageBikes: () => void
  /** 切换当前记录；AI 复盘卡片里可直接换一条，不必绕去「看板」页的历史列表 */
  onSelectRide: (id: string) => void
}

/** 「记录」分页:今日打卡(内嵌于录入卡片顶部)+ 详细录入 + 本次评分 + 路线评价 + 概览与保养提醒 */
export default function RecordTab({
  rides,
  bikes,
  days,
  selected,
  selectedBikeName,
  editing,
  onCancelEdit,
  onSave,
  onEdit,
  onCheckIn,
  onClearToday,
  onManageBikes,
  onSelectRide,
}: Props) {
  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
      <section className="card xl:col-span-7">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-wide text-t2">
          {editing ? '✏️ 编辑骑行记录' : '➕ 记录一次骑行'}
          {editing && (
            <button
              type="button"
              className="ml-auto text-xs font-normal text-t3 hover:text-t1"
              onClick={onCancelEdit}
            >
              取消编辑
            </button>
          )}
        </div>
        <RideForm
          key={editing?.id ?? 'new'}
          initialRecord={editing}
          bikes={bikes}
          onSave={onSave}
          onCancelEdit={onCancelEdit}
          checkInSlot={
            editing ? undefined : (
              <RideCheckIn
                bikes={bikes}
                days={days}
                rides={rides}
                onCheckIn={onCheckIn}
                onClearToday={onClearToday}
                onEditRide={onEdit}
              />
            )
          }
        />
      </section>

      {/* 右列:本次评分 + 路线评价(同一列内纵向堆叠) */}
      <div className="space-y-5 xl:col-span-5">
        <section className="card">
          <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold tracking-wide text-t2">
            <span>📊 本次评分{selected ? ` · ${selected.date}` : ''}</span>
            {selected?.routeName && <span className="text-xs font-normal text-t3">路线：{selected.routeName}</span>}
            {selectedBikeName && (
              <span className="flex items-center gap-1 text-xs font-normal text-accent-sky-text">
                <BikeIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate" title={selectedBikeName}>
                  单车：{selectedBikeName}
                </span>
              </span>
            )}
            {selected?.startName && (
              <span className="flex max-w-full items-center gap-1 text-xs font-normal text-accent-amber-text">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate" title={selected.startName}>
                  起点：{selected.startName}
                </span>
              </span>
            )}
          </div>
          {selected ? (
            <ScoreCard record={selected} />
          ) : (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-t4">
              <span className="text-3xl">🚴‍♂️</span>
              <p>还没有骑行记录</p>
              <p className="text-xs">在左侧录入数据、导入 GPX 或绘制路线后保存，即可看到评分</p>
            </div>
          )}
        </section>

        {/*
          AI 教练复盘。权限与可用性由组件内部判断：
          非管理员账号、或后端未配置 API Key 时，整块不渲染（连按钮都不出现）。
        */}
        {selected && <CoachReviewCard record={selected} rides={rides} onSelectRide={onSelectRide} />}

        {/* 路线评价:自己在该路线上的历史统计 + 他人评价(预留) */}
        <RouteReviews routeName={selected?.routeName} rides={rides} />

        {/* 近 30 天概览与保养提醒:填补右列空白,提供日常最常看的两类信息 */}
        <StatsOverview rides={rides} />
        <MaintenanceAlerts bikes={bikes} onManage={onManageBikes} />
      </div>
    </div>
  )
}
