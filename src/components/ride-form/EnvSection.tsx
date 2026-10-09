import { CloudSun } from 'lucide-react'
import type { EnvData } from '../../types'
import { numOrEmpty, type RideFormModel } from './useRideForm'

type Props = Pick<
  RideFormModel,
  'env' | 'envMeta' | 'envLoading' | 'handleFetchEnv' | 'setEnvField' | 'rideTimes'
>

/** 环境数据的字段定义:顺序即界面顺序,避免七组「标签 + 输入框」重复写七遍 */
const FIELDS: { key: keyof EnvData; label: string; min?: number; max?: number; step?: string }[] = [
  { key: 'temperature', label: '气温（℃）', step: '0.1' },
  { key: 'windLevel', label: '风力（级）', min: 0, max: 12 },
  { key: 'humidity', label: '湿度（%）', min: 0, max: 100 },
  { key: 'precipitation', label: '降水量（mm）', min: 0, step: '0.1' },
  { key: 'precipitationProbability', label: '降雨概率（%）', min: 0, max: 100 },
  { key: 'aqi', label: 'AQI', min: 0 },
  { key: 'pm25', label: 'PM2.5 (μg/m³)', min: 0 },
]

/**
 * 环境数据:由 Open-Meteo 自动采集(按骑行时段提取逐小时降雨),所有字段都可手动修正,
 * 并标注数据来源与采集失败原因。
 */
export default function EnvSection({ env, envMeta, envLoading, handleFetchEnv, setEnvField, rideTimes }: Props) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="card-title mb-0">
          <CloudSun className="h-4 w-4 text-accent-sky-text" aria-hidden="true" />
          环境数据（自动采集，可手动修正）
        </h3>
        <button type="button" className="btn-primary" disabled={envLoading} onClick={() => void handleFetchEnv()}>
          {envLoading ? '采集中…' : '获取环境数据'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="field-label">{f.label}</label>
            <input
              type="number"
              min={f.min}
              max={f.max}
              step={f.step}
              className="field-input"
              value={numOrEmpty(env[f.key])}
              onChange={(e) => setEnvField(f.key, e.target.value)}
            />
          </div>
        ))}
        <div className="flex items-end">
          <div className="flex flex-wrap gap-1.5 pb-1 text-[10px]">
            {envMeta.weatherFetched && (
              <span className="rounded bg-accent-emerald/15 px-1.5 py-0.5 text-accent-emerald-text">天气已采集</span>
            )}
            {envMeta.aqiFetched && (
              <span className="rounded bg-accent-emerald/15 px-1.5 py-0.5 text-accent-emerald-text">
                AQI已采集{envMeta.aqiSource ? ` · ${envMeta.aqiSource}` : ''}
              </span>
            )}
            {envMeta.manualEdited && (
              <span className="rounded bg-accent-amber/15 px-1.5 py-0.5 text-accent-amber-text">已手动修改</span>
            )}
            {rideTimes && (
              <span className="rounded bg-accent-sky/15 px-1.5 py-0.5 text-accent-sky-text">已识别骑行时段</span>
            )}
          </div>
        </div>
      </div>

      {envMeta.weatherNote && <p className="mt-2 text-xs text-t3">天气：{envMeta.weatherNote}</p>}
      {(envMeta.weatherError || envMeta.aqiError) && (
        <div className="mt-2 space-y-1 text-xs text-accent-red-text">
          {envMeta.weatherError && <p>天气：{envMeta.weatherError}(可手动填写)</p>}
          {envMeta.aqiError && <p>空气质量：{envMeta.aqiError}</p>}
        </div>
      )}
    </section>
  )
}
