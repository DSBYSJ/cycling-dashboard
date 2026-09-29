import type { RideRecord } from '../types'
import { describeRideOption } from '../utils/rideOption'

/**
 * 记录选择器：在当前位置直接切换「当前记录」，不必先跳到看板页的历史列表点一下再回来。
 *
 * 只负责渲染下拉，**不持有状态** —— 当前选中项由调用方（`selectedId`）决定，
 * 这样它和页面其它部分（评分卡、地图、AI 复盘）永远看的是同一条记录，不会各说各话。
 */
interface Props {
  rides: RideRecord[]
  selectedId: string
  onSelect: (id: string) => void
  /** 前置说明文字，写清「切换会影响什么」 */
  label: string
}

export default function RidePicker({ rides, selectedId, onSelect, label }: Props) {
  // 只有一条记录时无从可选，整块不渲染（省一行高度）
  if (rides.length < 2) return null

  return (
    <label className="flex items-center gap-2 text-xs text-t3">
      <span className="shrink-0">{label}</span>
      <select
        className="field-input w-auto min-w-0 py-1"
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
      >
        {rides.map((ride) => (
          <option key={ride.id} value={ride.id}>
            {describeRideOption(ride)}
          </option>
        ))}
      </select>
    </label>
  )
}
