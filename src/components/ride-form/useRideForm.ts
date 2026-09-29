import { useCallback, useMemo, useRef, useState } from 'react'
import type { EnvData, EnvMeta, RideRecord, SurfaceType, TrafficLevel, TrackPoint } from '../../types'
import { CITIES } from '../../data/cities'
import {
  maxSpeedFromSeries,
  parseGPX,
  speedSeriesFromTrack,
  summarizeTrack,
  trackDistanceMeters,
} from '../../utils/gpxParser'
import { computeGain, enrichTrackElevation } from '../../hooks/useElevation'
import { useWeather } from '../../hooks/useWeather'
import type { RouteCandidate } from '../../hooks/useRoutePlanning'
import { reverseGeocodePlace } from '../../hooks/useRoutePlanning'
import { useAmap } from '../../hooks/useAmap'
import type { BikeWithStatus } from '../../utils/tire'
import type { HuaweiRideMock } from '../../utils/huaweiMock'
import { buildComment, buildSuggestions, computeScores, rainLevelLabel } from '../../utils/scoring'
import type { RouteOrigin } from '../RoutePlanner'
import type { ToastMessage, ToastType } from '../Toast'

export const EMPTY_ENV: EnvData = {
  temperature: null,
  windLevel: null,
  humidity: null,
  precipitation: null,
  precipitationProbability: null,
  aqi: null,
  pm25: null,
}

/** 必须显式标注 EnvMeta:否则 TS 会按字面量推断,丢掉 weatherError / aqiSource 等可选字段 */
const EMPTY_ENV_META: EnvMeta = { weatherFetched: false, aqiFetched: false, manualEdited: false }

/** 本地时区的今天 YYYY-MM-DD */
export function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 数字 → 输入框显示值(null/undefined 显示为空,避免出现 "null") */
export function numOrEmpty(v: string | number | null | undefined): string {
  return v == null ? '' : String(v)
}

interface Params {
  initialRecord?: RideRecord | null
  bikes: BikeWithStatus[]
  onSave: (record: RideRecord) => void
}

/**
 * 骑行录入表单的状态与全部业务逻辑。
 *
 * 抽成独立 hook 的目的:把「表单状态 + GPX 解析 + 路线规划回调 + 海拔采样 + 环境采集 + 评分预览 + 保存」
 * 从视图里分离出来,组件只负责渲染。后续接入真实手表接口或调整评分口径时,改动集中在这里。
 */
export function useRideForm({ initialRecord, bikes, onSave }: Params) {
  const isEdit = initialRecord != null

  /* ---------------- 基本信息 ---------------- */
  const [date, setDate] = useState(initialRecord?.date ?? todayLocal())
  const [bikeId, setBikeId] = useState(initialRecord?.bikeId ?? '')
  const [cityName, setCityName] = useState(initialRecord?.cityName || '广州')
  const [customCode, setCustomCode] = useState(
    initialRecord && !CITIES.some((c) => c.name === initialRecord.cityName) ? initialRecord.cityCode : ''
  )
  const [durationMin, setDurationMin] = useState(initialRecord?.durationMin?.toString() ?? '')
  const [distanceKm, setDistanceKm] = useState(initialRecord?.distanceKm?.toString() ?? '')
  const [avgSpeed, setAvgSpeed] = useState(initialRecord?.avgSpeed?.toString() ?? '')
  const [maxSpeed, setMaxSpeed] = useState(initialRecord?.maxSpeed?.toString() ?? '')
  const [notes, setNotes] = useState(initialRecord?.notes ?? '')
  /** 起点位置名称:规划起点/轨迹起点自动得出,也可手动填写 */
  const [startName, setStartName] = useState(initialRecord?.startName ?? '')
  /** 起点所在市区(如「广州市天河区」) */
  const [startDistrict, setStartDistrict] = useState(initialRecord?.startDistrict ?? '')
  const [startNameLoading, setStartNameLoading] = useState(false)

  /* ---------------- 路线属性 ---------------- */
  const [elevationGain, setElevationGain] = useState(initialRecord?.route.elevationGain?.toString() ?? '')
  const [avgGrade, setAvgGrade] = useState(initialRecord?.route.avgGrade?.toString() ?? '')
  const [surface, setSurface] = useState<SurfaceType>(initialRecord?.route.surface ?? 'asphalt')
  const [traffic, setTraffic] = useState<TrafficLevel>(initialRecord?.route.traffic ?? 'low')

  /* ---------------- 轨迹与路线规划 ---------------- */
  const [track, setTrack] = useState<TrackPoint[] | null>(initialRecord?.track.length ? initialRecord.track : null)
  const [trackSource, setTrackSource] = useState<'gpx' | 'drawn' | 'route' | null>(
    initialRecord && initialRecord.track.length ? 'gpx' : null
  )
  const [routeName, setRouteName] = useState(initialRecord?.routeName ?? '')
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  /** 路线规划起点:null 表示使用所选城市的中心 */
  const [routeOrigin, setRouteOrigin] = useState<RouteOrigin | null>(null)
  /** 是否处于「在地图上选择起点」模式 */
  const [pickingOrigin, setPickingOrigin] = useState(false)
  const [speedSeries, setSpeedSeries] = useState(initialRecord?.speedSeries ?? [])
  const [rideTimes, setRideTimes] = useState<{ startISO: string; endISO: string } | null>(null)
  const [gpxMessage, setGpxMessage] = useState('')
  const [drawMode, setDrawMode] = useState(false)
  const [elevLoading, setElevLoading] = useState(false)

  /* ---------------- 环境数据 ---------------- */
  const [env, setEnv] = useState<EnvData>(initialRecord?.env ?? EMPTY_ENV)
  const [envMeta, setEnvMeta] = useState(initialRecord?.envMeta ?? EMPTY_ENV_META)
  const { loading: envLoading, fetchEnv } = useWeather()

  /* ---------------- 提示 ---------------- */
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const toastIdRef = useRef(0)
  /** 弹出一条 Toast(同一时刻只显示一条,重复触发会重新计时) */
  const showToast = useCallback((message: string, type: ToastType) => {
    toastIdRef.current += 1
    setToast({ id: toastIdRef.current, message, type })
  }, [])

  const { amap } = useAmap()
  const amapRef = useRef(amap)
  amapRef.current = amap

  const city = CITIES.find((c) => c.name === cityName)
  const cityCode = customCode.trim() || city?.code || ''
  const selectedBike = bikes.find((b) => b.id === bikeId) ?? null

  /** 环境数据查询用的坐标:有轨迹用轨迹起点,否则用所选城市中心 */
  const location = useMemo(() => {
    if (track && track.length > 0) return { lat: track[0].lat, lon: track[0].lon }
    return city ? { lat: city.lat, lon: city.lon } : null
  }, [track, city])

  /** 采集环境数据:坐标为显式传入时优先使用(如刚选中的规划路线起点) */
  const fetchEnvFor = useCallback(
    async (loc: { lat: number; lon: number } | null, times: { startISO: string; endISO: string } | null) => {
      if (!loc) {
        setEnvMeta((m) => ({ ...m, weatherError: '请先选择城市，或导入/规划/绘制路线以确定位置' }))
        return
      }
      const result = await fetchEnv({
        lat: loc.lat,
        lon: loc.lon,
        date,
        cityCode,
        rideStartISO: times?.startISO ?? null,
        rideEndISO: times?.endISO ?? null,
      })
      setEnv((prev) => ({ ...prev, ...result.weather, ...(result.aqi ?? {}) }))
      setEnvMeta(result.meta)
    },
    [cityCode, date, fetchEnv]
  )

  /** 实时评分预览 */
  const preview = useMemo(() => {
    const scores = computeScores(env, {
      elevationGain: elevationGain ? parseFloat(elevationGain) : null,
      avgGrade: avgGrade ? parseFloat(avgGrade) : null,
      surface,
      traffic,
    })
    return { scores, rainLabel: rainLevelLabel(scores.rainFactor, env.precipitation, env.precipitationProbability) }
  }, [env, elevationGain, avgGrade, surface, traffic])

  /** 根据坐标反查起点地名与所在市区并写入表单(失败时退化为坐标文本) */
  const applyStartNameFromPoint = useCallback(async (point: TrackPoint, preferredName?: string) => {
    const coords = `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`
    const ns = amapRef.current
    if (!ns) {
      setStartName(preferredName || coords)
      return
    }
    setStartNameLoading(true)
    try {
      const place = await reverseGeocodePlace(ns, [point.lon, point.lat])
      setStartName(preferredName || place?.name || coords)
      setStartDistrict(place?.district ?? '')
    } catch {
      setStartName(preferredName || coords)
    } finally {
      setStartNameLoading(false)
    }
  }, [])

  /* ---------------- GPX 导入 ---------------- */
  const handleGPXFile = async (file: File) => {
    setGpxMessage('')
    try {
      const xml = await file.text()
      const { points, name, stats } = parseGPX(xml)
      const summary = summarizeTrack(points)
      const series = speedSeriesFromTrack(points)

      /**
       * 距离与爬升优先用**设备自带的统计**（华为等厂商写在 <extensions> 里）。
       *
       * 自己算的两处都有已知偏差（实测一份 34,701 点的华为 GPX）：
       *   · 距离：逐段 Haversine 累加会把 GPS 抖动也算进去 → 119.54 km，设备统计 117.32 km
       *   · 爬升：为过滤噪声设了 1m 阈值，缓坡的累积上升被一并滤掉 → 396 m，设备统计 463 m
       */
      const distanceKm =
        stats.distanceMeters != null
          ? Math.round((stats.distanceMeters / 1000) * 100) / 100
          : summary.distanceKm
      const elevationGain =
        stats.climbMeters != null ? Math.round(stats.climbMeters) : summary.elevationGain

      setTrack(points)
      setTrackSource('gpx')
      setSelectedCandidateId(null)
      setRouteName(name || file.name.replace(/\.gpx$/i, ''))
      void applyStartNameFromPoint(points[0]) // 起点位置由首个轨迹点反查得到
      setDistanceKm(String(distanceKm))
      // 平均坡度跟着用同一套距离/爬升重算，否则会和上面两个数字自相矛盾
      if (distanceKm > 0) {
        setAvgGrade(String(Math.round((elevationGain / (distanceKm * 1000)) * 10000) / 100))
      } else if (summary.avgGrade != null) {
        setAvgGrade(String(summary.avgGrade))
      }
      setElevationGain(String(elevationGain))
      setSpeedSeries(series)
      const peak = maxSpeedFromSeries(series)
      if (peak != null) setMaxSpeed(String(peak))
      const firstTime = points.find((p) => p.time)?.time
      const lastTime = [...points].reverse().find((p) => p.time)?.time
      if (firstTime && lastTime && firstTime !== lastTime) {
        setRideTimes({ startISO: firstTime, endISO: lastTime })
        /**
         * 时长优先用设备的**运动时长**（totalTime），而不是首尾时间戳之差。
         *
         * 首尾差把中间的休息、吃饭、拍照全算了进去。实测同一份记录：
         * 首尾跨度 610 分钟，而设备统计的运动时长只有 420 分钟 ——
         * 拿首尾差算均速，会把 17.1 km/h 算成 11.8 km/h（低了 31%）。
         */
        const wallMinutes = (Date.parse(lastTime) - Date.parse(firstTime)) / 60000
        const minutes = stats.durationSeconds != null ? stats.durationSeconds / 60 : wallMinutes
        if (minutes > 1) {
          setDurationMin(String(Math.round(minutes)))
          setAvgSpeed(String(Math.round((distanceKm / (minutes / 60)) * 10) / 10))
        }
        const durationNote =
          stats.durationSeconds != null ? `，运动时长 ${Math.round(minutes)} 分钟（设备统计）` : ''
        setGpxMessage(
          `已导入 ${file.name}:${points.length} 个轨迹点，距离 ${distanceKm} km,爬升 ${elevationGain} m${durationNote}。已识别骑行时段，获取环境数据时将按该时段提取逐小时降雨。`
        )
      } else {
        setRideTimes(null)
        setGpxMessage(
          `已导入 ${file.name}:${points.length} 个轨迹点，距离 ${distanceKm} km,爬升 ${elevationGain} m(无时间戳，不生成速度曲线)。`
        )
      }
    } catch (err) {
      setGpxMessage(`GPX 导入失败：${err instanceof Error ? err.message : String(err)}`)
      setRideTimes(null)
    }
  }

  /* ---------------- 地图绘制 ---------------- */
  const handleDrawn = async (points: TrackPoint[]) => {
    if (points.length < 2) return
    setTrack(points)
    setTrackSource('drawn')
    setSpeedSeries([])
    setRideTimes(null)
    setDrawMode(false)
    setRouteName('手绘路线')
    void applyStartNameFromPoint(points[0])
    // 高德 JS API 无免费海拔查询,用 Open-Meteo Elevation 采样估算;采样点同时用于海拔曲线
    setElevLoading(true)
    try {
      const enriched = await enrichTrackElevation(points)
      const km = Math.round((trackDistanceMeters(enriched) / 1000) * 100) / 100
      const gain = computeGain(enriched)
      setTrack(enriched)
      setDistanceKm(String(km))
      setElevationGain(String(gain))
      setAvgGrade(String(Math.round((gain / Math.max(1, km * 1000)) * 10000) / 100))
      setGpxMessage(`已绘制路线：${km} km,海拔采样 ${enriched.length} 点估算爬升 ${gain} m。`)
    } catch (err) {
      const km = Math.round((trackDistanceMeters(points) / 1000) * 100) / 100
      setDistanceKm(String(km))
      setGpxMessage(
        `已绘制路线：${km} km。海拔采样失败(${err instanceof Error ? err.message : String(err)}),请手动填写累计爬升。`
      )
    } finally {
      setElevLoading(false)
    }
  }

  /* ---------------- 自动规划的路线:选中后自动填数据并采集环境数据 ---------------- */
  const handleRouteCandidate = async (candidate: RouteCandidate) => {
    setSelectedCandidateId(candidate.id)
    setRouteName(candidate.name)
    // 起点位置:名称用用户选定的起点(我的位置 / 搜索到的地点 / 地图选点),
    // 同时反查该点的所在市区,历史记录里显示到区
    const start = candidate.path[0]
    void applyStartNameFromPoint(start, routeOrigin?.label)
    setTrack(candidate.path)
    setTrackSource('route')
    setSpeedSeries([])
    setRideTimes(null)
    setDrawMode(false)
    setDistanceKm(String(candidate.distanceKm))
    setDurationMin(String(candidate.durationMin))
    setAvgSpeed(String(candidate.avgSpeed))
    setMaxSpeed('')
    setGpxMessage(
      `已选择「${candidate.name}」:${candidate.distanceKm} km,预计 ${candidate.durationMin} 分钟。正在采样海拔并采集环境数据…`
    )

    // 海拔采样(Open-Meteo Elevation),同时用于海拔曲线与爬升估算
    let gain: number | null = null
    setElevLoading(true)
    try {
      const enriched = await enrichTrackElevation(candidate.path)
      gain = computeGain(enriched)
      setTrack(enriched)
      setElevationGain(String(gain))
      setAvgGrade(String(Math.round((gain / Math.max(1, candidate.distanceKm * 1000)) * 10000) / 100))
    } catch {
      // 采样失败不阻塞流程,累加爬升可手动填写
    } finally {
      setElevLoading(false)
    }

    // 用路线起点作为位置,自动采集天气与空气质量
    await fetchEnvFor({ lat: start.lat, lon: start.lon }, null)

    setGpxMessage(
      `已选择「${candidate.name}」:${candidate.distanceKm} km,预计 ${candidate.durationMin} 分钟` +
        (gain != null ? `,采样估算爬升 ${gain} m` : ',海拔采样失败请手动填写爬升') +
        '。环境数据已自动采集，可直接保存。'
    )
  }

  /* ---------------- 华为手表数据同步(当前为本地模拟数据) ---------------- */
  const handleHuaweiData = useCallback(
    (data: HuaweiRideMock) => {
      setDistanceKm(String(data.distance))
      setDurationMin(String(data.duration))
      setAvgSpeed(String(data.averageSpeed))
      setMaxSpeed(String(data.maxSpeed))
      setElevationGain(String(data.elevationGain))
      setRouteName(data.routeName)
      setNotes(`路线名称：${data.routeName}`)
      // 表单字段变化后,右侧评分预览会通过 useMemo 自动重新计算
      showToast('华为数据同步成功', 'success')
    },
    [showToast]
  )

  /* ---------------- 环境数据采集 ---------------- */
  const handleFetchEnv = async () => {
    await fetchEnvFor(location, rideTimes)
  }

  const setEnvField = (key: keyof EnvData, raw: string) => {
    const value = raw.trim() === '' ? null : Number(raw)
    setEnv((prev) => ({ ...prev, [key]: value != null && Number.isFinite(value) ? value : null }))
    setEnvMeta((m) => ({ ...m, manualEdited: true }))
  }

  /* ---------------- 保存 ---------------- */
  const handleSubmit = () => {
    const distance = parseFloat(distanceKm)
    if (!date) {
      showToast('请填写骑行日期', 'error')
      return
    }
    if (!Number.isFinite(distance) || distance <= 0) {
      showToast('请填写有效的骑行距离（km）', 'error')
      return
    }
    const gain = elevationGain ? parseFloat(elevationGain) : null
    const grade = avgGrade ? parseFloat(avgGrade) : null
    const route = {
      elevationGain: gain != null && Number.isFinite(gain) ? gain : null,
      avgGrade: grade != null && Number.isFinite(grade) ? grade : null,
      surface,
      traffic,
    }
    const scores = computeScores(env, route)
    const now = Date.now()
    const record: RideRecord = {
      id: initialRecord?.id ?? `ride_${now}_${Math.random().toString(36).slice(2, 8)}`,
      label: initialRecord?.label,
      bikeId: bikeId || undefined,
      checkIn: initialRecord?.checkIn,
      date,
      durationMin: durationMin ? parseFloat(durationMin) : null,
      distanceKm: Math.round(distance * 100) / 100,
      avgSpeed: avgSpeed ? parseFloat(avgSpeed) : null,
      maxSpeed: maxSpeed ? parseFloat(maxSpeed) : null,
      cityName: customCode.trim() && !city ? '自定义城市' : cityName,
      cityCode,
      startName: startName.trim() || undefined,
      startDistrict: startDistrict.trim() || undefined,
      location,
      env,
      envMeta,
      route,
      track: track ?? [],
      routeName: routeName.trim() || undefined,
      speedSeries,
      scores,
      comment: buildComment(env, scores),
      suggestions: buildSuggestions(env, route),
      notes,
      createdAt: initialRecord?.createdAt ?? now,
      updatedAt: now,
    }
    // 保存时若所选单车的外胎已超期,提醒用户检查外胎状态
    if (selectedBike?.tire?.level === 'expired') {
      showToast(`单车「${selectedBike.name}」的外胎已超过建议使用寿命，请注意检查外胎状态`, 'error')
    }
    onSave(record)
    if (!isEdit) resetAfterSave()
  }

  /** 新建保存后清空表单(编辑模式保留内容,便于连续微调) */
  const resetAfterSave = () => {
    setDistanceKm('')
    setDurationMin('')
    setAvgSpeed('')
    setMaxSpeed('')
    setTrack(null)
    setTrackSource(null)
    setRouteName('')
    setStartName('')
    setStartDistrict('')
    setSelectedCandidateId(null)
    setSpeedSeries([])
    setRideTimes(null)
    setGpxMessage('')
    setEnv(EMPTY_ENV)
    setEnvMeta(EMPTY_ENV_META)
    setNotes('')
    setBikeId('')
  }

  return {
    isEdit,
    // 基本信息
    date,
    setDate,
    cityName,
    setCityName,
    customCode,
    setCustomCode,
    city,
    cityCode,
    location,
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
    // 路线属性
    elevationGain,
    setElevationGain,
    avgGrade,
    setAvgGrade,
    surface,
    setSurface,
    traffic,
    setTraffic,
    // 轨迹与规划
    track,
    trackSource,
    routeName,
    selectedCandidateId,
    setSelectedCandidateId,
    routeOrigin,
    setRouteOrigin,
    pickingOrigin,
    setPickingOrigin,
    drawMode,
    setDrawMode,
    gpxMessage,
    elevLoading,
    handleGPXFile,
    handleDrawn,
    handleRouteCandidate,
    // 环境
    env,
    envMeta,
    envLoading,
    handleFetchEnv,
    setEnvField,
    rideTimes,
    // 其它
    preview,
    notes,
    setNotes,
    handleHuaweiData,
    handleSubmit,
    toast,
    setToast,
    showToast,
  }
}

export type RideFormModel = ReturnType<typeof useRideForm>
