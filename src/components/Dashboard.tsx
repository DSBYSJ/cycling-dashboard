import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Moon, Sun, WifiOff } from 'lucide-react'
import type { Bike, RideRecord } from '../types'
import { useRides, useBikes, useDays, type SyncState } from '../hooks/useCloudData'
import { useLegacyMigration } from '../hooks/useLegacyMigration'
import { useTheme } from '../hooks/useTheme'
import { useTabRoute, type TabId } from '../hooks/useTabRoute'
import { withTireStatus } from '../utils/tire'
import { describeSimplification, simplifyTrack } from '../utils/trackSimplify'
import type { ImportSummary } from '../utils/backup'
import Toast, { type ToastMessage, type ToastType } from './Toast'
import AccountMenu from './AccountMenu'
import { HAS_FILING, FilingRecords } from './FilingRecords'
import { useAuth } from '../hooks/useAuth'

/**
 * 分页组件按需加载:「看板」页包含高德地图与四个手写图表,是首屏体积的大头,
 * 拆包后只在用户真正切换过去时才下载。
 */
const RecordTab = lazy(() => import('./tabs/RecordTab'))
const DashboardTab = lazy(() => import('./tabs/DashboardTab'))
const BikesTab = lazy(() => import('./tabs/BikesTab'))
// 站长控制台只有管理员会打开，单独拆包，普通用户根本不会下载到管理端代码
const AdminTab = lazy(() => import('./admin/AdminTab'))

const TABS: { id: TabId; label: string }[] = [
  { id: 'record', label: '记录' },
  { id: 'dashboard', label: '看板' },
  { id: 'bikes', label: '单车与轮胎' },
]

/** 只有管理员看得到的分页。权限在后端判 —— 这里只是不给普通用户显示一个打不开的入口 */
const ADMIN_TAB: { id: TabId; label: string } = { id: 'admin', label: '站长' }

/** 生成下一条记录的路线编号:取现有数字编号最大值 +1,重命名过的非数字名称不参与 */
function nextRideLabel(rides: RideRecord[]): string {
  const nums = rides
    .map((r) => (r.label ?? '').trim())
    .filter((s) => /^\d+$/.test(s))
    .map((s) => parseInt(s, 10))
  const max = nums.length ? Math.max(...nums) : 0
  // 与记录条数取较大值,避免用户全部改名后编号从 1 重来
  return String(Math.max(max, rides.length) + 1)
}

/** 今天(本地时区)的 YYYY-MM-DD */
function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function TabFallback() {
  return (
    <div className="card flex h-40 items-center justify-center text-sm text-t4" role="status" aria-live="polite">
      正在加载…
    </div>
  )
}

const BANNER_OFFLINE =
  'flex items-start gap-2 rounded-lg border border-accent-amber/30 bg-accent-amber/10 px-3 py-2 text-xs leading-5 text-accent-amber-text'
const BANNER_PENDING =
  'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-sky/30 bg-accent-sky/10 px-3 py-2 text-xs leading-5 text-accent-sky-text'

export default function Dashboard() {
  const {
    rides,
    loading,
    sync: ridesSync,
    error: ridesError,
    clearError: clearRidesError,
    save,
    saveMany: saveManyRides,
    remove,
    refresh: refreshRides,
    ensureDetail,
    detailLoadingId,
  } = useRides()
  const {
    bikes: rawBikes,
    sync: bikesSync,
    error: bikesError,
    clearError: clearBikesError,
    save: saveBike,
    saveMany: saveManyBikes,
    remove: removeBike,
    refresh: refreshBikes,
  } = useBikes()
  const {
    days,
    sync: daysSync,
    error: daysError,
    clearError: clearDaysError,
    save: saveDay,
    saveMany: saveManyDays,
    remove: removeDay,
    refresh: refreshDays,
  } = useDays()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<RideRecord | null>(null)
  const { tab, navigate } = useTabRoute()
  const { isAdmin } = useAuth()
  const visibleTabs = useMemo(() => (isAdmin ? [...TABS, ADMIN_TAB] : TABS), [isAdmin])

  /**
   * 出行建议用的地点：取最近一条带坐标的记录。
   * 用「最近一次骑过的地方」而不是浏览器定位 —— 零授权打扰，也更贴近真实活动范围。
   */
  const adviceLocation = useMemo(() => {
    const located = rides.filter((r) => r.location)
    if (!located.length) return null
    return [...located].sort((a, b) => b.date.localeCompare(a.date))[0].location
  }, [rides])

  // 普通账号手动把地址改成 #/admin 时直接送回去：后端一定会 403，
  // 与其让他看到一个满是报错的页面，不如回到记录页
  useEffect(() => {
    if (tab === 'admin' && !isAdmin) navigate('record')
  }, [tab, isAdmin, navigate])
  const { theme, toggle: toggleTheme } = useTheme()

  /** 三个集合的同步状态合并:任意一个离线就整体按离线处理 */
  const syncState: SyncState = useMemo(() => {
    const states = [ridesSync, bikesSync, daysSync]
    if (states.includes('cache')) return 'cache'
    if (states.every((s) => s === 'cloud')) return 'cloud'
    return 'loading'
  }, [ridesSync, bikesSync, daysSync])

  const [toast, setToast] = useState<ToastMessage | null>(null)
  const toastIdRef = useRef(0)
  const showToast = useCallback((type: ToastType, message: string) => {
    toastIdRef.current += 1
    setToast({ id: toastIdRef.current, type, message })
  }, [])

  /** 三个集合里任意一个写入失败(网络断了、服务器拒绝、会话过期)时统一提示一次 */
  const storageError = ridesError ?? bikesError ?? daysError
  useEffect(() => {
    if (!storageError) return
    showToast('error', `保存失败：${storageError}`)
    clearRidesError()
    clearBikesError()
    clearDaysError()
  }, [storageError, showToast, clearRidesError, clearBikesError, clearDaysError])

  /* ---------------- 旧数据迁移（以前只存在浏览器里的记录） ---------------- */

  const cloudReady = ridesSync !== 'loading' && bikesSync !== 'loading' && daysSync !== 'loading'
  const refreshAll = useCallback(() => {
    void refreshRides()
    void refreshBikes()
    void refreshDays()
  }, [refreshRides, refreshBikes, refreshDays])

  const migration = useLegacyMigration({
    cloudReady,
    cloudCount: rides.length + rawBikes.length + days.length,
    onImported: refreshAll,
  })

  useEffect(() => {
    if (migration.status !== 'done' || !migration.uploaded) return
    const { rides: r, bikes: b, days: d, skipped } = migration.uploaded
    if (r + b + d === 0) return
    const parts = [`${r} 条骑行记录`, `${b} 辆车`, `${d} 条打卡`].filter((_, i) => [r, b, d][i] > 0)
    showToast('success', `已把本机的${parts.join('、')}上传到云端${skipped > 0 ? `，跳过 ${skipped} 条` : ''}`)
  }, [migration.status, migration.uploaded, showToast])

  useEffect(() => {
    if (migration.status === 'error' && migration.error) {
      showToast('error', `本机数据上传失败：${migration.error}`)
    }
  }, [migration.status, migration.error, showToast])

  /* ---------------- 业务逻辑 ---------------- */

  /** 打开某条记录进行编辑(自动切回「记录」页) */
  const startEdit = useCallback(
    (record: RideRecord) => {
      setEditing(record)
      navigate('record')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [navigate]
  )

  /** 单车列表附加上累计里程与外胎寿命状态 */
  const bikes = useMemo(() => withTireStatus(rawBikes, rides), [rawBikes, rides])

  // 默认选中最新一条
  useEffect(() => {
    if (rides.length > 0 && (selectedId == null || !rides.some((r) => r.id === selectedId))) {
      setSelectedId(rides[0].id)
    }
  }, [rides, selectedId])

  const selected = useMemo(() => rides.find((r) => r.id === selectedId) ?? null, [rides, selectedId])

  /**
   * 列表接口不含轨迹，所以选中某条时要按需把详情（含 GPS 轨迹）拉回来，地图与曲线才有内容。
   *
   * 依赖里必须带上「当前这条是否还缺轨迹」这个布尔值，不能只依赖 selectedId：
   * 数据被云端列表刷新覆盖后（列表不带轨迹），selectedId 并没有变化，
   * 只靠它触发就再也补不回来了 —— 这正是「第一次打开有轨迹、刷新一次就没了」的成因。
   */
  const selectedNeedsTrack = Boolean(selected?.hasTrack && selected.track.length === 0)
  useEffect(() => {
    if (selectedId && selectedNeedsTrack) void ensureDetail(selectedId)
  }, [selectedId, selectedNeedsTrack, ensureDetail])

  /** 外胎是否需要关注:超期(红)/接近寿命(琥珀),用于分页角标 */
  const tireAlert = useMemo(() => {
    const levels = bikes.map((b) => b.tire?.level).filter(Boolean)
    if (levels.includes('expired')) return 'expired' as const
    if (levels.includes('soon')) return 'soon' as const
    return null
  }, [bikes])

  /** 当前记录使用的单车名称 */
  const selectedBikeName = useMemo(() => {
    if (!selected?.bikeId) return null
    return bikes.find((b) => b.id === selected.bikeId)?.name ?? null
  }, [selected, bikes])

  const handleSave = useCallback(
    async (record: RideRecord) => {
      /**
       * 保存前先把轨迹抽稀到后端上限（2 万点）以内。
       *
       * 不做这一步，长距离骑行或手机直录会直接撞上服务端校验，
       * 用户只看到「保存失败：轨迹点过多」—— 一次辛苦骑下来的数据全丢。
       * 而多出来的那些点对显示毫无意义：屏幕就这么宽，相邻点早就落进同一个像素了。
       *
       * 刻意**不静默处理**：精简了就明确告诉用户精简了多少（见下面的提示）。
       */
      const simplified = simplifyTrack(record.track)
      const next = simplified.changed ? { ...record, track: simplified.points } : record

      // 新建记录没有编号时自动分配(1、2、3…),之后可在历史列表里重命名
      await save(next.label ? next : { ...next, label: nextRideLabel(rides) })
      if (simplified.changed) showToast('info', describeSimplification(simplified))
      setSelectedId(record.id)
      setEditing(null)
    },
    [rides, save, showToast]
  )

  /** 在历史列表里重命名路线编号 */
  const handleRename = useCallback(
    async (id: string, label: string) => {
      const record = rides.find((r) => r.id === id)
      if (!record || (record.label ?? '') === label) return
      await save({ ...record, label: label || undefined, updatedAt: Date.now() })
    },
    [rides, save]
  )

  /**
   * 今日骑行打卡:
   * 骑了 → 生成一条今天的骑行记录并关联所选单车,该车的累计里程/骑行次数/最近骑行日期
   * 与外胎寿命随即在「单车与轮胎管理」中更新(自动同步);距离可留空,之后补充详细数据。
   * 没骑 → 只记录当天的休息状态。
   */
  const handleCheckIn = useCallback(
    async (input: { rode: boolean; bikeId?: string; distanceKm?: number }) => {
      const today = todayLocal()
      const now = Date.now()
      const existing = days.find((d) => d.date === today) ?? null

      if (!input.rode) {
        await removeDay(today) // 覆盖当天原有打卡，避免残留旧的骑行记录关联
        await saveDay({ id: today, date: today, rode: false, createdAt: now })
        if (existing?.rideId) await remove(existing.rideId)
        return null
      }

      const record: RideRecord = {
        id: `ride_checkin_${now}_${Math.random().toString(36).slice(2, 8)}`,
        label: nextRideLabel(rides), // 打卡记录同样分配路线编号
        bikeId: input.bikeId,
        checkIn: true,
        date: today,
        durationMin: null,
        distanceKm: input.distanceKm ?? null,
        avgSpeed: null,
        maxSpeed: null,
        cityName: '',
        cityCode: '',
        location: null,
        env: {
          temperature: null,
          windLevel: null,
          humidity: null,
          precipitation: null,
          precipitationProbability: null,
          aqi: null,
          pm25: null,
        },
        envMeta: { weatherFetched: false, aqiFetched: false, manualEdited: false },
        route: { elevationGain: null, avgGrade: null, surface: null, traffic: null },
        track: [],
        speedSeries: [],
        scores: null, // 打卡记录不参与评分与趋势
        comment: '',
        suggestions: [],
        notes: '',
        createdAt: now,
        updatedAt: now,
      }
      await save(record)
      // 同一天重复打卡时,删掉上一次生成的记录,保持一天一条
      if (existing?.rideId && existing.rideId !== record.id) await remove(existing.rideId)
      await saveDay({
        id: today,
        date: today,
        rode: true,
        bikeId: input.bikeId,
        distanceKm: input.distanceKm,
        rideId: record.id,
        createdAt: now,
      })
      setSelectedId(record.id)
      return record.id
    },
    [days, rides, save, saveDay, remove, removeDay]
  )

  /** 撤销今日打卡(打卡生成的骑行记录一并删除) */
  const handleClearToday = useCallback(async () => {
    const today = todayLocal()
    const entry = days.find((d) => d.date === today)
    if (!entry) return
    if (entry.rideId) await remove(entry.rideId)
    await removeDay(today)
  }, [days, remove, removeDay])

  /** 从备份文件恢复:合并写入(同 ID 覆盖)。入参已在 parseBackup 里校验归一化过。 */
  const handleImport = useCallback(
    async (summary: ImportSummary) => {
      const bikeResult = await saveManyBikes(summary.bikes)
      const dayResult = await saveManyDays(summary.days)
      const rideResult = await saveManyRides(summary.rides)
      // 返回服务端实际写入的条数（格式不合法的会被服务端跳过），失败时是 0
      return {
        rides: rideResult?.imported ?? 0,
        bikes: bikeResult?.imported ?? 0,
        days: dayResult?.imported ?? 0,
      }
    },
    [saveManyBikes, saveManyDays, saveManyRides]
  )

  const handleSaveBike = useCallback((bike: Bike) => void saveBike(bike), [saveBike])
  const handleRemoveBike = useCallback((id: string) => void removeBike(id), [removeBike])
  const handleSelect = useCallback((id: string) => setSelectedId(id), [])
  const handleDelete = useCallback((id: string) => void remove(id), [remove])
  const handleCancelEdit = useCallback(() => setEditing(null), [])
  const manageBikes = useCallback(() => navigate('bikes'), [navigate])

  return (
    <div className="min-h-full">
      {/* 顶栏 */}
      <header className="sticky top-0 z-20 border-b border-line bg-page/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🚴</span>
            <h1 className="text-base font-bold tracking-wide text-t1">骑行评分监测看板</h1>
            <span className="hidden rounded-full border border-accent-sky/30 bg-accent-sky/10 px-2 py-0.5 text-[10px] text-accent-sky-text sm:inline">
              天气 60% · 路线 40%
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-t4">
            {loading ? (
              <span>加载中…</span>
            ) : (
              <>
                <span className="hidden sm:inline">{rides.length} 条记录</span>
                <span
                  className="hidden rounded-full border border-line bg-fill px-2 py-0.5 sm:inline"
                  title={
                    syncState === 'cloud'
                      ? '数据已与服务器同步'
                      : syncState === 'cache'
                        ? '连不上服务器，正在显示本机缓存（只读）'
                        : '正在同步…'
                  }
                >
                  {syncState === 'cloud' ? '已同步' : syncState === 'cache' ? '离线・只读' : '同步中…'}
                </span>
              </>
            )}
            {/* 明暗(昼夜)切换 */}
            <button
              type="button"
              onClick={toggleTheme}
              title={theme === 'dark' ? '切换到日间（浅色）模式' : '切换到夜间（深色）模式'}
              aria-label={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
              className="flex items-center gap-1 rounded-full border border-line bg-fill px-2.5 py-1 text-t2 transition hover:bg-fill-strong"
            >
              {theme === 'dark' ? (
                <Sun className="h-3.5 w-3.5 text-accent-amber" aria-hidden="true" />
              ) : (
                <Moon className="h-3.5 w-3.5 text-accent-sky" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{theme === 'dark' ? '日间' : '夜间'}</span>
            </button>
            <AccountMenu onOpenAdmin={() => navigate('admin')} />
          </div>
        </div>

        {/* 分页导航:把长页面拆成三块,每屏只显示相关内容;与 URL hash 同步 */}
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 md:px-6" role="tablist">
          {visibleTabs.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => navigate(t.id)}
                className={`relative whitespace-nowrap rounded-t-lg px-4 py-2 text-sm transition ${
                  active ? 'font-medium text-accent-sky-text' : 'text-t3 hover:text-t1'
                }`}
              >
                {t.label}
                {t.id === 'dashboard' && rides.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-fill-strong px-1.5 py-0.5 text-[10px] text-t3">
                    {rides.length}
                  </span>
                )}
                {t.id === 'bikes' && tireAlert && (
                  <span
                    className={`ml-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                      tireAlert === 'expired' ? 'bg-accent-red' : 'bg-accent-amber'
                    }`}
                    title={tireAlert === 'expired' ? '有外胎超过建议寿命' : '有外胎接近寿命'}
                  />
                )}
                {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent-sky" />}
              </button>
            )
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-6">
        {/* 离线提示：说明现在的数据是缓存副本、改动存不进去 */}
        {syncState === 'cache' && (
          <div className={BANNER_OFFLINE} role="status">
            <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              连不上服务器，正在显示本机缓存的副本。<b className="font-medium">此状态下改动无法保存</b>
              ，网络恢复后刷新页面即可继续。
            </span>
          </div>
        )}

        {/* 本机还有旧记录没上传（云端已有数据时留给用户决定） */}
        {migration.pending && (
          <div className={BANNER_PENDING} role="status">
            <span>
              这台浏览器里还有 {migration.pending.rides} 条骑行记录、{migration.pending.bikes} 辆车、
              {migration.pending.days} 条打卡没有上传到云端。
            </span>
            <span className="flex shrink-0 gap-2">
              <button
                type="button"
                className="btn-solid-sky"
                onClick={() => void migration.upload()}
                disabled={migration.status === 'uploading'}
              >
                {migration.status === 'uploading' ? '上传中…' : '上传到云端'}
              </button>
              <button type="button" className="btn-ghost" onClick={migration.dismissPending}>
                忽略
              </button>
            </span>
          </div>
        )}

        {detailLoadingId && (
          <div className="text-[11px] text-t4" role="status" aria-live="polite">
            正在加载这条记录的 GPS 轨迹…
          </div>
        )}

        <Suspense fallback={<TabFallback />}>
          {tab === 'record' && (
            <RecordTab
              rides={rides}
              bikes={bikes}
              days={days}
              selected={selected}
              selectedBikeName={selectedBikeName}
              editing={editing}
              onCancelEdit={handleCancelEdit}
              onSave={handleSave}
              onEdit={startEdit}
              onCheckIn={handleCheckIn}
              onClearToday={handleClearToday}
              onManageBikes={manageBikes}
            />
          )}

          {tab === 'dashboard' && (
            <DashboardTab
              rides={rides}
              bikes={bikes}
              rawBikes={rawBikes}
              days={days}
              selected={selected}
              selectedId={selectedId}
              onSelect={handleSelect}
              onEdit={startEdit}
              onDelete={handleDelete}
              onRename={handleRename}
              onImport={handleImport}
              adviceLocation={adviceLocation}
            />
          )}

          {tab === 'bikes' && <BikesTab bikes={bikes} onSave={handleSaveBike} onRemove={handleRemoveBike} />}

          {tab === 'admin' && isAdmin && <AdminTab />}
        </Suspense>

        <footer className="space-y-2 pb-6 text-center text-[11px] text-t4">
          <p>天气与空气质量：Open-Meteo · 海拔：Open-Meteo Elevation · 地图与路线：高德 · 数据保存在你自己的服务器上</p>
          <p>
            <a className="transition hover:text-t2" href="./privacy.html" target="_blank" rel="noreferrer">
              隐私政策
            </a>
            <span className="mx-2 text-t5">·</span>
            <a className="transition hover:text-t2" href="./terms.html" target="_blank" rel="noreferrer">
              用户协议
            </a>
            {/* 备案信息来自环境变量；两者都没有时连分隔符一起不渲染 */}
            {HAS_FILING && (
              <>
                <span className="mx-2 text-t5">·</span>
                <FilingRecords />
              </>
            )}
          </p>
        </footer>
      </main>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}
