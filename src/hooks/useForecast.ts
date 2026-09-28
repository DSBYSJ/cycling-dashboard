import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  bestOverall,
  bestWindowPerDay,
  type HourlyPoint,
  type TripWindow,
} from '../utils/forecast'

/**
 * 出行建议数据层：拉未来 7 天的逐小时预报，算出每天的「最佳出行窗口」。
 *
 * 两个数据源（都免 Key）：
 *   · Open-Meteo forecast —— 温度 / 湿度 / 降水 / 降雨概率 / 风速
 *   · Open-Meteo Air Quality —— us_aqi（与评分口径一致）
 * 空气质量失败**不整个报错**，只是那部分分数不含 AQI，界面上会说明。
 */

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const HOURLY_FIELDS =
  'temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,wind_speed_10m'
/** 含今天在内一共取几天 */
const FORECAST_DAYS = 7
const TIMEOUT_MS = 12000

interface OpenMeteoHourly {
  hourly?: {
    time?: string[]
    temperature_2m?: (number | null)[]
    relative_humidity_2m?: (number | null)[]
    precipitation?: (number | null)[]
    precipitation_probability?: (number | null)[]
    wind_speed_10m?: (number | null)[]
    us_aqi?: (number | null)[]
  }
}

export interface ForecastDay {
  /** `YYYY-MM-DD` */
  date: string
  /** 「今天 / 明天 / 周三」 */
  label: string
  window: TripWindow | null
}

export interface TripAdviceState {
  loading: boolean
  error: string | null
  /** 整段时间里最值得出门的那一个窗口 */
  best: TripWindow | null
  days: ForecastDay[]
  /** 空气质量预报是否可用；不可用时分数不含 AQI，界面要说明 */
  aqiAvailable: boolean
  refresh(): void
}

async function getJSON<T>(url: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/** 「今天 / 明天 / 周三」——索引按日期升序 */
export function dayLabel(date: string, index: number): string {
  if (index === 0) return '今天'
  if (index === 1) return '明天'
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const parsed = new Date(`${date}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? date : weekdays[parsed.getDay()]
}

async function loadPoints(lat: number, lon: number): Promise<{ points: HourlyPoint[]; aqiAvailable: boolean }> {
  const query = `latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=${FORECAST_DAYS}`
  const [weather, air] = await Promise.allSettled([
    getJSON<OpenMeteoHourly>(`${FORECAST_URL}?${query}&hourly=${HOURLY_FIELDS}`),
    getJSON<OpenMeteoHourly>(`${AIR_QUALITY_URL}?${query}&hourly=us_aqi`),
  ])

  if (weather.status === 'rejected') throw new Error('天气预报获取失败，请稍后重试')
  const hourly = weather.value.hourly
  const times = hourly?.time ?? []
  if (!times.length) throw new Error('天气预报没有返回逐小时数据')

  // 按时刻对齐空气质量；拿不到就留 null，不影响其它维度
  const aqiByTime = new Map<string, number>()
  if (air.status === 'fulfilled') {
    const airHourly = air.value.hourly
    ;(airHourly?.time ?? []).forEach((time, index) => {
      const value = airHourly?.us_aqi?.[index]
      if (value != null) aqiByTime.set(time, value)
    })
  }

  const points: HourlyPoint[] = times.map((time, index) => ({
    time,
    temperature: hourly?.temperature_2m?.[index] ?? null,
    humidity: hourly?.relative_humidity_2m?.[index] ?? null,
    precipitation: hourly?.precipitation?.[index] ?? null,
    precipitationProbability: hourly?.precipitation_probability?.[index] ?? null,
    windKmh: hourly?.wind_speed_10m?.[index] ?? null,
    aqi: aqiByTime.get(time) ?? null,
  }))

  return { points, aqiAvailable: aqiByTime.size > 0 }
}

/**
 * @param location 常用地点坐标；为 null 时不做任何请求（界面上引导用户先记录一次骑行）
 */
export function useForecast(location: { lat: number; lon: number } | null): TripAdviceState {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState<ForecastDay[]>([])
  const [aqiAvailable, setAqiAvailable] = useState(false)
  /** 组件卸载后不再 setState（切分页时请求可能还没回来） */
  const aliveRef = useRef(true)

  const lat = location?.lat ?? null
  const lon = location?.lon ?? null

  const load = useCallback(async () => {
    if (lat == null || lon == null) {
      setDays([])
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { points, aqiAvailable: hasAqi } = await loadPoints(lat, lon)
      if (!aliveRef.current) return
      const windows = bestWindowPerDay(points)
      const dates = [...new Set(points.map((p) => p.time.slice(0, 10)))].sort()
      setDays(dates.map((date, index) => ({ date, label: dayLabel(date, index), window: windows[index] ?? null })))
      setAqiAvailable(hasAqi)
    } catch (err) {
      if (!aliveRef.current) return
      setError(err instanceof Error ? err.message : '出行建议获取失败')
      setDays([])
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [lat, lon])

  useEffect(() => {
    aliveRef.current = true
    void load()
    return () => {
      aliveRef.current = false
    }
  }, [load])

  const best = useMemo(() => bestOverall(days.map((d) => d.window)), [days])

  return { loading, error, best, days, aqiAvailable, refresh: load }
}
