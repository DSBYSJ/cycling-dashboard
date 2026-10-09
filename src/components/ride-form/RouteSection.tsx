import { useRef } from 'react'
import { Map as MapIcon } from 'lucide-react'
import MapView from '../MapView'
import RoutePlanner from '../RoutePlanner'
import type { RideFormModel } from './useRideForm'

type Props = Pick<
  RideFormModel,
  | 'cityName'
  | 'city'
  | 'track'
  | 'trackSource'
  | 'routeName'
  | 'drawMode'
  | 'setDrawMode'
  | 'pickingOrigin'
  | 'setPickingOrigin'
  | 'routeOrigin'
  | 'setRouteOrigin'
  | 'selectedCandidateId'
  | 'setSelectedCandidateId'
  | 'gpxMessage'
  | 'elevLoading'
  | 'handleGPXFile'
  | 'handleDrawn'
  | 'handleRouteCandidate'
>

/**
 * 路线数据:自动规划(真实路网) / GPX 导入 / 地图手绘,三者共用同一张地图与同一份轨迹状态。
 * 手绘与「地图点选起点」互斥,避免地图点击语义冲突。
 */
export default function RouteSection({
  cityName,
  city,
  track,
  trackSource,
  routeName,
  drawMode,
  setDrawMode,
  pickingOrigin,
  setPickingOrigin,
  routeOrigin,
  setRouteOrigin,
  selectedCandidateId,
  setSelectedCandidateId,
  gpxMessage,
  elevLoading,
  handleGPXFile,
  handleDrawn,
  handleRouteCandidate,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <section>
      <h3 className="card-title">
        <MapIcon className="h-4 w-4 text-accent-sky-text" aria-hidden="true" />
        路线（自动规划 / GPX 导入 / 地图绘制）
      </h3>

      <RoutePlanner
        city={cityName}
        cityCenter={city ? { lat: city.lat, lon: city.lon } : null}
        selectedId={selectedCandidateId}
        onSelect={(c) => void handleRouteCandidate(c)}
        origin={routeOrigin}
        onOriginChange={(o) => {
          setRouteOrigin(o)
          setSelectedCandidateId(null)
        }}
        picking={pickingOrigin}
        onPickingChange={(on) => {
          setPickingOrigin(on)
          if (on) setDrawMode(false) // 点选与手绘互斥，避免地图点击语义冲突
        }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-xs text-t4">或者：</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".gpx,application/gpx+xml,text/xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleGPXFile(file)
            e.target.value = ''
          }}
        />
        <button type="button" className="btn-ghost" onClick={() => fileInputRef.current?.click()}>
          导入 GPX 文件
        </button>
        <button
          type="button"
          className={drawMode ? 'btn btn-solid-amber' : 'btn-ghost'}
          onClick={() => {
            setDrawMode(!drawMode)
            setPickingOrigin(false) // 手绘与点选互斥
          }}
        >
          {drawMode ? '结束绘制' : '地图绘制路线'}
        </button>
        {trackSource && (
          <span className="rounded-full bg-accent-sky/15 px-2.5 py-1 text-xs text-accent-sky-text">
            {trackSource === 'gpx' ? 'GPX 轨迹' : trackSource === 'route' ? `规划路线 · ${routeName || '未命名'}` : '绘制路线'} ·{' '}
            {track?.length ?? 0} 点
          </span>
        )}
        {elevLoading && <span className="text-xs text-t3">海拔采样中…</span>}
      </div>
      {gpxMessage && <p className="mt-2 text-xs text-t3">{gpxMessage}</p>}

      <div className="mt-3">
        <MapView
          track={track}
          drawEnabled={drawMode}
          onDrawn={(p) => void handleDrawn(p)}
          pickMode={pickingOrigin}
          pickHint="点击地图选择起点"
          originMarker={routeOrigin}
          onPick={(point) => {
            setRouteOrigin({ lat: point.lat, lon: point.lon, label: '地图选点' })
            setSelectedCandidateId(null)
            setPickingOrigin(false)
          }}
        />
      </div>
    </section>
  )
}
