import { useCallback, useState } from 'react'
import type { EnvData, EnvMeta } from '../types'
import { kmhToBeaufort } from '../utils/wind'

/**
 * 环境数据采集:
 * - 天气 Open-Meteo(免 Key):近 ~92 天用 forecast 接口(past_days),更早自动切 archive 历史接口
 *   (历史接口不含「降雨概率」字段,此时降雨指数只按降水量计算,并在界面上说明)
 * - 空气质量 Open-Meteo Air Quality(免 Key,主数据源):与天气同源、支持跨域与历史日期,
 *   提供 us_aqi 与 pm2_5;sojson 作为备选(该接口常限流且浏览器端跨域受限)
 * - GPX 带时间戳时,按骑行时段提取逐小时数据(用返回的 utc_offset_seconds 把 UTC 时间戳对齐到当地时刻)
 */

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const FORECAST_PAST_LIMIT = 92
const AQI_HISTORY_START_YEAR = 2022

const HOURLY_WITH_PROB = 'temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,wind_speed_10m'
const HOURLY_NO_PROB = 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m'
const DAILY_WITH_PROB = 'temperature_2m_mean,precipitation_sum,precipitation_probability_max,wind_speed_10m_max'
const DAILY_NO_PROB = 'temperature_2m_mean,precipitation_sum,wind_speed_10m_max'

/**
 * km/h 风速 → 蒲福风力等级。
 * 实现已提到 `utils/wind.ts`（出行建议模块也要用，避免 utils 反向依赖 hooks），
 * 这里继续导出，原有引用方不必改。
 */
export { kmhToBeaufort }

/** 统一的 JSON 请求:带超时,由调用处用具体响应类型收窄返回结构 */
function fetchJSON<T>(url: string, timeoutMs = 10000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<T>
    })
    .finally(() => clearTimeout(timer))
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 目标日期距今天的天数(正数=过去) */
function daysFromToday(date: string): number {
  const target = Date.parse(`${date}T00:00:00Z`)
  const today = Date.parse(`${todayISO()}T00:00:00Z`)
  return Math.round((today - target) / 86400000)
}

/**
 * Open-Meteo 的逐小时时间戳形如 "2026-09-14T05:00",是当地时刻(无时区标记)。
 * 统一按「当地时刻当 UTC」解析,再与「UTC 时刻 + 当地偏移」比较,避免时区错位。
 */
function hourKeyToEpoch(t: string): number {
  const iso = t.length === 16 ? `${t}:00Z` : `${t}Z`
  return Date.parse(iso)
}

interface HourlySlice {
  time: string[]
  temperature_2m?: (number | null)[]
  relative_humidity_2m?: (number | null)[]
  precipitation?: (number | null)[]
  precipitation_probability?: (number | null)[]
  wind_speed_10m?: (number | null)[]
  us_aqi?: (number | null)[]
  pm2_5?: (number | null)[]
}

/** sojson 备选接口的响应(只用到 data.aqi / data.pm25) */
interface SojsonResponse {
  data?: { aqi?: string | number; pm25?: string | number }
}

interface OpenMeteoResponse {
  utc_offset_seconds?: number
  daily?: Record<string, (number | null)[] | string[]>
  hourly?: HourlySlice
}

interface RideWindow {
  startISO?: string | null
  endISO?: string | null
}

/** 取出落在骑行时段内的逐小时值;未提供时段或匹配不足时返回 null */
function pickRideWindow<T>(
  hourly: HourlySlice | undefined,
  key: keyof HourlySlice,
  window: RideWindow,
  utcOffsetSeconds: number
): T[] | null {
  const values = hourly?.[key]
  if (!hourly?.time?.length || !Array.isArray(values)) return null
  if (!window.startISO || !window.endISO) return null
  const offsetMs = utcOffsetSeconds * 1000
  const start = Date.parse(window.startISO) + offsetMs
  const end = Date.parse(window.endISO) + offsetMs
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  const picked: T[] = []
  hourly.time.forEach((t, i) => {
    const ms = hourKeyToEpoch(t)
    const v = values[i]
    if (ms >= start && ms <= end && v != null) picked.push(v as T)
  })
  return picked.length ? picked : null
}

/** 取出某一整天的逐小时值 */
function pickDay<T>(hourly: HourlySlice | undefined, key: keyof HourlySlice, date: string): T[] {
  const values = hourly?.[key]
  if (!hourly?.time?.length || !Array.isArray(values)) return []
  const out: T[] = []
  hourly.time.forEach((t, i) => {
    const v = values[i]
    if (t.startsWith(date) && v != null) out.push(v as T)
  })
  return out
}

const mean = (nums: number[]): number | null =>
  nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null

export interface WeatherParams {
  lat: number
  lon: number
  /** 骑行日期 YYYY-MM-DD */
  date: string
  /** 骑行时段(来自 GPX 时间戳,UTC),提供时按逐小时数据提取 */
  rideStartISO?: string | null
  rideEndISO?: string | null
}

export interface WeatherResult {
  env: Partial<EnvData>
  /** 数据来源补充说明(历史接口无降雨概率等) */
  note?: string
}

/** 调用 Open-Meteo 获取某地点某日的天气 */
export async function fetchWeather(params: WeatherParams): Promise<WeatherResult> {
  const { lat, lon, date } = params
  const daysAgo = daysFromToday(date)

  let url: string
  if (daysAgo > FORECAST_PAST_LIMIT) {
    // 超过 92 天:改用历史归档接口(不含降雨概率)
    url =
      `${ARCHIVE_URL}?latitude=${lat}&longitude=${lon}&hourly=${HOURLY_NO_PROB}` +
      `&daily=${DAILY_NO_PROB}&start_date=${date}&end_date=${date}&timezone=auto`
  } else if (daysAgo >= 0) {
    url =
      `${FORECAST_URL}?latitude=${lat}&longitude=${lon}&hourly=${HOURLY_WITH_PROB}&daily=${DAILY_WITH_PROB}` +
      `&past_days=${Math.min(daysAgo + 1, FORECAST_PAST_LIMIT)}&forecast_days=7&timezone=auto`
  } else {
    // 未来日期:预报接口最多 16 天
    if (-daysAgo > 16) throw new Error(`${date} 距今超过 16 天，暂无天气预报数据`)
    url =
      `${FORECAST_URL}?latitude=${lat}&longitude=${lon}&hourly=${HOURLY_WITH_PROB}&daily=${DAILY_WITH_PROB}` +
      `&past_days=0&forecast_days=${-daysAgo + 1}&timezone=auto`
  }

  const data = await fetchJSON<OpenMeteoResponse>(url)
  const daily = data.daily
  const dailyTime = (daily?.time as string[] | undefined) ?? []
  if (!dailyTime.length) throw new Error('未查询到该日期的天气数据')
  const dayIndex = dailyTime.indexOf(date)
  if (dayIndex < 0) throw new Error(`天气服务没有 ${date} 的数据（超出可查询范围）`)

  const offset = data.utc_offset_seconds ?? 0
  const hourly = data.hourly
  const window: RideWindow = { startISO: params.rideStartISO, endISO: params.rideEndISO }
  const usedRideWindow = Boolean(window.startISO && window.endISO)

  const dailyValue = (key: string): number | null => {
    const arr = daily?.[key] as (number | null)[] | undefined
    const v = arr?.[dayIndex]
    return v != null && Number.isFinite(v) ? v : null
  }

  const tempWindow = pickRideWindow<number>(hourly, 'temperature_2m', window, offset)
  const humidityWindow = pickRideWindow<number>(hourly, 'relative_humidity_2m', window, offset)
  const precipWindow = pickRideWindow<number>(hourly, 'precipitation', window, offset)
  const probWindow = pickRideWindow<number>(hourly, 'precipitation_probability', window, offset)
  const windWindow = pickRideWindow<number>(hourly, 'wind_speed_10m', window, offset)

  const temperature = mean(tempWindow ?? pickDay<number>(hourly, 'temperature_2m', date)) ?? dailyValue('temperature_2m_mean')
  const humidity = mean(humidityWindow ?? pickDay<number>(hourly, 'relative_humidity_2m', date))
  const precipitation = precipWindow
    ? precipWindow.reduce((a, b) => a + b, 0)
    : dailyValue('precipitation_sum')
  const precipitationProbability =
    mean(probWindow ?? pickDay<number>(hourly, 'precipitation_probability', date)) ??
    dailyValue('precipitation_probability_max')
  const windKmh = windWindow ? Math.max(...windWindow) : dailyValue('wind_speed_10m_max')

  const notes: string[] = []
  if (daysAgo > FORECAST_PAST_LIMIT) {
    notes.push('历史归档接口不含降雨概率，降雨指数仅按降水量估算')
  }
  if (usedRideWindow && precipWindow) {
    notes.push('已按骑行时段提取逐小时降雨')
  } else if (usedRideWindow) {
    notes.push('骑行时段无逐小时数据，改用当日汇总')
  }

  return {
    env: {
      temperature: temperature != null ? Math.round(temperature * 10) / 10 : null,
      humidity: humidity != null ? Math.round(humidity) : null,
      precipitation: precipitation != null ? Math.round(precipitation * 10) / 10 : null,
      precipitationProbability:
        precipitationProbability != null ? Math.round(precipitationProbability) : null,
      windLevel: windKmh != null ? kmhToBeaufort(windKmh) : null,
    },
    note: notes.length ? notes.join(';') : undefined,
  }
}

export interface AqiResult {
  aqi: number
  pm25: number | null
  source: string
}

/**
 * 空气质量(主数据源:Open-Meteo Air Quality)。
 * us_aqi 的分档阈值(50/100/150)与评分规则一致,支持历史日期(2022 年起)与跨域请求。
 */
export async function fetchAirQuality(params: WeatherParams): Promise<AqiResult> {
  const { lat, lon, date } = params
  const daysAgo = daysFromToday(date)
  const year = Number(date.slice(0, 4))
  if (daysAgo > 0 && year < AQI_HISTORY_START_YEAR) {
    throw new Error(`${date} 早于空气质量历史数据范围（${AQI_HISTORY_START_YEAR} 年起），请手动填写`)
  }

  let url: string
  if (daysAgo >= 0) {
    url = `${AIR_QUALITY_URL}?latitude=${lat}&longitude=${lon}&hourly=us_aqi,pm2_5&start_date=${date}&end_date=${date}&timezone=auto`
  } else if (-daysAgo <= 7) {
    url = `${AIR_QUALITY_URL}?latitude=${lat}&longitude=${lon}&hourly=us_aqi,pm2_5&forecast_days=${-daysAgo + 1}&timezone=auto`
  } else {
    throw new Error(`${date} 距今超过 7 天，暂无空气质量预报，请稍后再查或手动填写`)
  }

  const data: OpenMeteoResponse = await fetchJSON(url)
  const hourly = data.hourly
  const offset = data.utc_offset_seconds ?? 0
  const window: RideWindow = { startISO: params.rideStartISO, endISO: params.rideEndISO }

  const aqiValues =
    pickRideWindow<number>(hourly, 'us_aqi', window, offset) ?? pickDay<number>(hourly, 'us_aqi', date)
  const pmValues =
    pickRideWindow<number>(hourly, 'pm2_5', window, offset) ?? pickDay<number>(hourly, 'pm2_5', date)

  const aqi = mean(aqiValues)
  if (aqi == null) throw new Error(`空气质量服务没有 ${date} 的数据`)
  const pm25 = mean(pmValues)

  return {
    aqi: Math.round(aqi),
    pm25: pm25 != null ? Math.round(pm25 * 10) / 10 : null,
    source: 'Open-Meteo 空气质量',
  }
}

/** 备选:sojson 空气质量(常限流/跨域受限,仅在主数据源失败时尝试) */
export async function fetchAqiFromSojson(cityCode: string): Promise<AqiResult> {
  if (!cityCode) throw new Error('未提供城市编码')
  const data = await fetchJSON<SojsonResponse>(`https://api.sojson.com/api/weather/city/${cityCode}`, 8000)
  const aqiRaw = data?.data?.aqi
  const aqi = aqiRaw != null ? parseInt(String(aqiRaw), 10) : NaN
  if (!Number.isFinite(aqi)) throw new Error('sojson 数据解析失败')
  const pm25Raw = data?.data?.pm25
  const pm25 = pm25Raw != null ? parseFloat(String(pm25Raw)) : NaN
  return { aqi, pm25: Number.isFinite(pm25) ? pm25 : null, source: 'sojson' }
}

export interface EnvFetchResult {
  weather: Partial<EnvData> | null
  aqi: { aqi: number; pm25: number | null } | null
  meta: EnvMeta
}

/** 一次性采集天气 + 空气质量,单项失败不影响另一项 */
export async function fetchEnvironment(
  params: WeatherParams & { cityCode: string }
): Promise<EnvFetchResult> {
  const [weatherResult, aqiResult] = await Promise.allSettled([
    fetchWeather(params),
    fetchAirQuality(params).catch(async (primaryErr: unknown) => {
      // 主数据源失败时,若有城市编码则尝试 sojson 备选
      if (!params.cityCode) throw primaryErr
      try {
        return await fetchAqiFromSojson(params.cityCode)
      } catch {
        throw primaryErr
      }
    }),
  ])

  const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : null
  const aqi = aqiResult.status === 'fulfilled' ? aqiResult.value : null

  const meta: EnvMeta = {
    weatherFetched: weather != null,
    aqiFetched: aqi != null,
    manualEdited: false,
    weatherError:
      weatherResult.status === 'rejected'
        ? String(weatherResult.reason?.message ?? weatherResult.reason)
        : undefined,
    aqiError:
      aqiResult.status === 'rejected' ? String(aqiResult.reason?.message ?? aqiResult.reason) : undefined,
    weatherNote: weather?.note,
    aqiSource: aqi?.source,
  }

  return { weather: weather?.env ?? null, aqi, meta }
}

/** 表单用的采集 Hook:管理加载态 */
export function useWeather() {
  const [loading, setLoading] = useState(false)

  const fetchEnv = useCallback(
    async (params: WeatherParams & { cityCode: string }): Promise<EnvFetchResult> => {
      setLoading(true)
      try {
        return await fetchEnvironment(params)
      } finally {
        setLoading(false)
      }
    },
    []
  )

  return { loading, fetchEnv }
}
