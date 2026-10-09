import type { ReactNode } from 'react'
import { CalendarCheck } from 'lucide-react'
import type { RideRecord } from '../types'
import type { BikeWithStatus } from '../utils/tire'
import HuaweiSyncButton from './HuaweiSyncButton'
import Toast from './Toast'
import { useRideForm } from './ride-form/useRideForm'
import BasicSection from './ride-form/BasicSection'
import RouteSection from './ride-form/RouteSection'
import RouteAttrSection from './ride-form/RouteAttrSection'
import EnvSection from './ride-form/EnvSection'
import SubmitSection from './ride-form/SubmitSection'

interface Props {
  initialRecord?: RideRecord | null
  onSave: (record: RideRecord) => void
  onCancelEdit?: () => void
  /** 可选的单车列表(带外胎寿命状态) */
  bikes?: BikeWithStatus[]
  /** 今日打卡区块(由父组件构造并注入,渲染在表单最上方) */
  checkInSlot?: ReactNode
}

/**
 * 骑行数据录入:手动输入 + GPX 导入 + 地图绘制 + 路线自动规划 + 环境数据采集(可手动修正)。
 *
 * 这里只负责编排;状态与全部业务逻辑在 `ride-form/useRideForm.ts`,
 * 各分区(基本信息 / 路线 / 路线属性 / 环境 / 保存)拆在 `ride-form/` 下,便于单独调整。
 */
export default function RideForm({ initialRecord, onSave, onCancelEdit, bikes = [], checkInSlot }: Props) {
  const form = useRideForm({ initialRecord, bikes, onSave })

  return (
    <div className="space-y-5">
      {/* 今日打卡(嵌入表单最上方,打卡与详细录入二选一) */}
      {checkInSlot && (
        <section>
          <h3 className="card-title">
            <CalendarCheck className="h-4 w-4 text-accent-emerald-text" aria-hidden="true" />
            今天骑了吗
          </h3>
          {checkInSlot}
          <div className="mt-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-fill-strong" aria-hidden="true" />
            <span className="text-[11px] text-t4">或填写下面详细数据</span>
            <span className="h-px flex-1 bg-fill-strong" aria-hidden="true" />
          </div>
        </section>
      )}

      <BasicSection {...form} bikes={bikes} />

      {/* 华为手表数据同步 */}
      <section className="rounded-xl border border-line bg-surface-2/50 px-4 py-3">
        <h3 className="card-title mb-3">⌚ 华为手表健康数据</h3>
        <HuaweiSyncButton onSynced={form.handleHuaweiData} onError={(msg) => form.showToast(msg, 'error')} />
        <p className="mt-2 text-[11px] leading-5 text-t4">
          当前为演示数据（华为 Health Kit 权限审核中），通过审核后将自动改为读取手表真实数据。
        </p>
      </section>

      <RouteSection {...form} />
      <RouteAttrSection {...form} />
      <EnvSection {...form} />
      <SubmitSection {...form} onCancelEdit={onCancelEdit} />

      {form.toast && <Toast toast={form.toast} onClose={() => form.setToast(null)} />}
    </div>
  )
}
