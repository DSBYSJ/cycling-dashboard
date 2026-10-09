import { AlertTriangle, ClipboardList } from 'lucide-react'
import { BIKE_CATEGORIES } from '../../types'
import { CITIES } from '../../data/cities'
import type { BikeWithStatus } from '../../utils/tire'
import { numOrEmpty, type RideFormModel } from './useRideForm'

type Props = Pick<
  RideFormModel,
  | 'date'
  | 'setDate'
  | 'cityName'
  | 'setCityName'
  | 'customCode'
  | 'setCustomCode'
  | 'startName'
  | 'setStartName'
  | 'startDistrict'
  | 'setStartDistrict'
  | 'startNameLoading'
  | 'bikeId'
  | 'setBikeId'
  | 'selectedBike'
  | 'distanceKm'
  | 'setDistanceKm'
  | 'durationMin'
  | 'setDurationMin'
  | 'avgSpeed'
  | 'setAvgSpeed'
  | 'maxSpeed'
  | 'setMaxSpeed'
  | 'location'
> & {
  bikes: BikeWithStatus[]
}

/** 基本信息:日期、城市、起点、单车、距离与速度。外胎接近/超过寿命时会就地提醒 */
export default function BasicSection({
  date,
  setDate,
  cityName,
  setCityName,
  customCode,
  setCustomCode,
  startName,
  setStartName,
  startDistrict,
  setStartDistrict,
  startNameLoading,
  bikeId,
  setBikeId,
  selectedBike,
  distanceKm,
  setDistanceKm,
  durationMin,
  setDurationMin,
  avgSpeed,
  setAvgSpeed,
  maxSpeed,
  setMaxSpeed,
  location,
  bikes,
}: Props) {
  return (
    <section>
      <h3 className="card-title">
        <ClipboardList className="h-4 w-4 text-accent-sky-text" aria-hidden="true" />
        基本信息
      </h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div>
          <label className="field-label">骑行日期 *</label>
          <input type="date" className="field-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label">城市（空气质量查询）</label>
          <select
            className="field-input"
            value={cityName}
            onChange={(e) => {
              setCityName(e.target.value)
              setCustomCode('')
            }}
          >
            {CITIES.map((c) => (
              <option key={c.code} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">自定义城市编码（可选）</label>
          <input
            className="field-input"
            placeholder="如 101280601"
            value={customCode}
            onChange={(e) => setCustomCode(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">
            起点位置{startNameLoading && <span className="ml-1 text-accent-sky">获取中…</span>}
          </label>
          <input
            className="field-input"
            placeholder="规划路线或导入 GPX 后自动填入，也可手动填写"
            value={startName}
            onChange={(e) => setStartName(e.target.value)}
            title={location ? `坐标：${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}` : undefined}
          />
        </div>
        <div>
          <label className="field-label">起点所在区</label>
          <input
            className="field-input"
            placeholder="自动识别，如 广州市天河区"
            value={startDistrict}
            onChange={(e) => setStartDistrict(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">单车</label>
          <select className="field-input" value={bikeId} onChange={(e) => setBikeId(e.target.value)}>
            <option value="">未指定</option>
            {bikes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}({BIKE_CATEGORIES[b.category]})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">距离（km） *</label>
          <input
            type="number"
            min="0"
            step="0.1"
            className="field-input"
            value={numOrEmpty(distanceKm)}
            onChange={(e) => setDistanceKm(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">时长（分钟）</label>
          <input
            type="number"
            min="0"
            className="field-input"
            value={numOrEmpty(durationMin)}
            onChange={(e) => setDurationMin(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">平均速度（km/h）</label>
          <input
            type="number"
            min="0"
            step="0.1"
            className="field-input"
            value={numOrEmpty(avgSpeed)}
            onChange={(e) => setAvgSpeed(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">最高速度（km/h）</label>
          <input
            type="number"
            min="0"
            step="0.1"
            className="field-input"
            value={numOrEmpty(maxSpeed)}
            onChange={(e) => setMaxSpeed(e.target.value)}
          />
        </div>
      </div>

      {/* 外胎寿命提醒:选中该车时立即提示,避免保存后才发现 */}
      {selectedBike?.tire?.level === 'expired' && (
        <p className="mt-2 flex gap-2 rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs leading-5 text-accent-red-text">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            单车「{selectedBike.name}」的{selectedBike.tire.tireName}已超过建议使用寿命(已骑{' '}
            {Math.round(selectedBike.tire.usedKm)} km / 建议 {selectedBike.tire.lifeKm} km,超期{' '}
            {Math.round(Math.abs(selectedBike.tire.remainingKm))} km),请注意检查外胎状态，及时更换。
          </span>
        </p>
      )}
      {selectedBike?.tire?.level === 'soon' && (
        <p className="mt-2 rounded-lg border border-accent-amber/30 bg-accent-amber/10 px-3 py-2 text-xs leading-5 text-accent-amber-text">
          单车「{selectedBike.name}」的{selectedBike.tire.tireName}接近建议寿命，还剩{' '}
          {Math.round(selectedBike.tire.remainingKm)} km,请留意胎面磨损。
        </p>
      )}
    </section>
  )
}
