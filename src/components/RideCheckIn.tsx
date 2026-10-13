import { useMemo, useState } from 'react'
import { Bike as BikeIcon, CheckCircle2, Moon, Pencil } from 'lucide-react'
import Toast, { type ToastMessage } from './Toast'
import type { DayCheckIn, RideRecord } from '../types'
import { BIKE_CATEGORIES } from '../types'
import type { BikeWithStatus } from '../utils/tire'

interface Props {
  bikes: BikeWithStatus[]
  /** 全部打卡记录 */
  days: DayCheckIn[]
  /** 全部骑行记录(用于找出打卡生成的记录) */
  rides: RideRecord[]
  /** 打卡:rode=true 时 bikeId 必填;返回生成的骑行记录 id(休息日返回 null) */
  onCheckIn: (input: { rode: boolean; bikeId?: string; distanceKm?: number }) => Promise<string | null>
  /** 撤销/修改今日打卡 */
  onClearToday: () => Promise<void>
  /** 补充打卡记录的详细数据(打开编辑表单) */
  onEditRide: (record: RideRecord) => void
}

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 连续骑行天数(从今天或最近一次骑行往前数) */
function rideStreak(days: DayCheckIn[]): number {
  const map = new Map(days.map((d) => [d.date, d.rode]))
  const cursor = new Date()
  // 今天还没打卡时,从昨天开始数
  if (!map.has(todayLocal())) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  for (let i = 0; i < 366; i++) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    if (map.get(key) === true) {
      streak += 1
      cursor.setDate(cursor.getDate() - 1)
    } else {
      break
    }
  }
  return streak
}

/** 今日骑行打卡:记录「今天是否骑行」,骑了则选择单车并自动同步到单车管理 */
export default function RideCheckIn({ bikes, days, rides, onCheckIn, onClearToday, onEditRide }: Props) {
  const today = todayLocal()
  const todayEntry = useMemo(() => days.find((d) => d.date === today) ?? null, [days, today])
  const [rode, setRode] = useState<boolean | null>(null)
  const [bikeId, setBikeId] = useState('')
  const [distance, setDistance] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<ToastMessage | null>(null)

  /** 上次骑过的单车(最近一条带单车的记录),作为默认选项 */
  const lastBikeId = useMemo(() => rides.find((r) => r.bikeId)?.bikeId ?? '', [rides])
  const defaultBikeId = lastBikeId && bikes.some((b) => b.id === lastBikeId) ? lastBikeId : ''

  /** 打卡生成的骑行记录(用于「补充详细数据」) */
  const checkInRide = useMemo(
    () => (todayEntry?.rideId ? rides.find((r) => r.id === todayEntry.rideId) ?? null : null),
    [todayEntry, rides]
  )

  const stats = useMemo(() => {
    const monthPrefix = today.slice(0, 7)
    const thisMonth = days.filter((d) => d.date.startsWith(monthPrefix))
    return {
      rodeDays: thisMonth.filter((d) => d.rode).length,
      restDays: thisMonth.filter((d) => !d.rode).length,
      streak: rideStreak(days),
      totalRodeDays: days.filter((d) => d.rode).length,
    }
  }, [days, today])

  const submit = async () => {
    if (rode == null) {
      setError('请先选择今天是否骑行')
      return
    }
    // 未手动选择时用「上次骑过的车」兜底
    const chosenBike = bikeId || defaultBikeId
    if (rode && !chosenBike) {
      setError('请选择今天骑的是哪辆车')
      return
    }
    setBusy(true)
    setError('')
    try {
      const km = parseFloat(distance)
      await onCheckIn({
        rode,
        bikeId: rode ? chosenBike : undefined,
        distanceKm: rode && Number.isFinite(km) && km > 0 ? km : undefined,
      })
      const bikeName = bikes.find((b) => b.id === chosenBike)?.name
      setToast({
        id: Date.now(),
        type: rode ? 'success' : 'info',
        message: rode ? `已记录今天的骑行${bikeName ? ' · ' + bikeName : ''}` : '已记录今天休息',
      })
      setRode(null)
      setBikeId('')
      setDistance('')
    } catch (err) {
      // 打卡内部已处理过网络错误并返回 false；这里兜住意外异常，
      // 否则会变成未捕获的 Promise rejection（用户看不到任何反馈）
      setError(err instanceof Error ? err.message : '打卡失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  // 今天已打卡
  if (todayEntry) {
    const bike = todayEntry.bikeId ? bikes.find((b) => b.id === todayEntry.bikeId) : null
    return (
      <div className="rounded-xl border border-accent-sky/20 bg-accent-sky/5 p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-2 text-sm font-semibold tracking-wide text-t2">
            {todayEntry.rode ? (
              <CheckCircle2 className="h-4 w-4 text-accent-emerald" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4 text-t3" aria-hidden="true" />
            )}
            今日已打卡 · {today}
          </span>

          {todayEntry.rode ? (
            <>
              <span className="text-sm text-accent-emerald-text">
                已骑行{bike ? ` · ${bike.name}(${BIKE_CATEGORIES[bike.category]})` : ''}
              </span>
              {todayEntry.distanceKm ? (
                <span className="text-sm text-t2">{todayEntry.distanceKm} km</span>
              ) : (
                <span className="text-xs text-t4">未填距离</span>
              )}
              {checkInRide && (
                <button type="button" className="btn-ghost !py-1 !text-xs" onClick={() => onEditRide(checkInRide)}>
                  <Pencil className="h-3 w-3" aria-hidden="true" />
                  补充详细数据
                </button>
              )}
            </>
          ) : (
            <span className="text-sm text-t3">今天休息</span>
          )}

          <button
            type="button"
            className="ml-auto text-[11px] text-t4 underline-offset-2 hover:text-t2 hover:underline"
            onClick={() => void onClearToday()}
          >
            重新打卡
          </button>
        </div>
        <StatsLine stats={stats} />
        {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
      </div>
    )
  }

  // 未打卡
  return (
    <div className="rounded-xl border border-accent-sky/20 bg-accent-sky/5 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-2 text-sm font-semibold tracking-wide text-t2">
          <BikeIcon className="h-4 w-4 text-accent-sky" aria-hidden="true" />
          今天是否骑行 · {today}
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={rode === true ? 'btn btn-solid-emerald' : 'btn-ghost'}
            onClick={() => {
              setRode(true)
              setError('')
            }}
          >
            骑了
          </button>
          <button
            type="button"
            className={rode === false ? 'btn btn-solid-neutral' : 'btn-ghost'}
            onClick={() => {
              setRode(false)
              setError('')
            }}
          >
            没骑（休息）
          </button>
        </div>

        {rode === true && (
          <>
            <select className="field-input !w-auto min-w-[170px]" value={bikeId || defaultBikeId} onChange={(e) => setBikeId(e.target.value)}>
              <option value="">选择单车…</option>
              {bikes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}({BIKE_CATEGORIES[b.category]})
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="0.1"
              className="field-input !w-[120px]"
              placeholder="距离（可选）"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
            />
          </>
        )}

        <button type="button" className="btn-primary" disabled={busy || rode == null} onClick={() => void submit()}>
          {busy ? '打卡中…' : '打卡'}
        </button>
      </div>

      {bikes.length === 0 && (
        <p className="mt-2 text-xs text-accent-amber-text">还没有单车 — 请先在「单车与轮胎」分页添加一辆，打卡时需要选择单车。</p>
      )}
      {rode === true && bikes.length > 0 && (
        <p className="mt-2 text-[11px] leading-5 text-t4">
          打卡会生成今天的骑行记录并关联该车（同步累计里程、骑行次数与外胎寿命）;距离可留空，之后点「补充详细数据」补全。
        </p>
      )}
      {error && <p className="mt-2 text-xs text-accent-red-text">{error}</p>}

      <StatsLine stats={stats} />
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}

function StatsLine({ stats }: { stats: { rodeDays: number; restDays: number; streak: number; totalRodeDays: number } }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line-soft pt-3 text-[11px] text-t4">
      <span>
        本月骑行 <span className="text-accent-emerald-text">{stats.rodeDays}</span> 天
      </span>
      <span>
        本月休息 <span className="text-t2">{stats.restDays}</span> 天
      </span>
      <span>
        连续骑行 <span className="text-accent-sky-text">{stats.streak}</span> 天
      </span>
      <span>
        累计打卡 <span className="text-t2">{stats.totalRodeDays}</span> 天
      </span>
    </div>
  )
}
