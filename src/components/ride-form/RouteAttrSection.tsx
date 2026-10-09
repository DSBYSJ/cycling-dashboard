import { Route } from 'lucide-react'
import { SURFACE_LABELS, TRAFFIC_LABELS, type SurfaceType, type TrafficLevel } from '../../types'
import { numOrEmpty, type RideFormModel } from './useRideForm'

type Props = Pick<
  RideFormModel,
  'elevationGain' | 'setElevationGain' | 'avgGrade' | 'setAvgGrade' | 'surface' | 'setSurface' | 'traffic' | 'setTraffic'
>

/** 路线属性:累计爬升、平均坡度、路面类型、交通流量(均可自动填入后手动修正) */
export default function RouteAttrSection({
  elevationGain,
  setElevationGain,
  avgGrade,
  setAvgGrade,
  surface,
  setSurface,
  traffic,
  setTraffic,
}: Props) {
  return (
    <section>
      <h3 className="card-title">
        <Route className="h-4 w-4 text-accent-sky-text" aria-hidden="true" />
        路线属性
      </h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <label className="field-label">累计爬升（m）</label>
          <input
            type="number"
            min="0"
            className="field-input"
            value={numOrEmpty(elevationGain)}
            onChange={(e) => setElevationGain(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">平均坡度（%）</label>
          <input
            type="number"
            min="0"
            step="0.1"
            className="field-input"
            value={numOrEmpty(avgGrade)}
            onChange={(e) => setAvgGrade(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">路面类型</label>
          <select className="field-input" value={surface} onChange={(e) => setSurface(e.target.value as SurfaceType)}>
            {Object.entries(SURFACE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">交通流量</label>
          <select className="field-input" value={traffic} onChange={(e) => setTraffic(e.target.value as TrafficLevel)}>
            {Object.entries(TRAFFIC_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  )
}
