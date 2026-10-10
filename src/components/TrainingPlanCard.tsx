import { useState } from 'react'
import { AlertTriangle, CalendarClock, CloudOff, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTrainingPlan } from '../hooks/useTrainingPlan'
import type { PlanRequest } from '../types'

/**
 * 训练计划卡片：结合最近骑行数据与目标，规划当日 / 次日的骑行量。
 *
 * ⚠️ 与 AI 教练复盘同一边界：**只对管理员（站长本人）渲染**。
 * 个人主体 ICP 备案不能面向公众提供生成式 AI 服务；后端已用权限钩子拦住接口，
 * 这里再挡一层 —— 组件比接口更容易被将来"顺手复用到别处"。
 *
 * 两条产品判断：
 * 1. **降级必须说清楚**：AI 不可用时展示规则兜底的保守计划，
 *    并明确标注它不是 AI 生成的 —— 冒充 AI 比没有 AI 更糟。
 * 2. **输入尽量少**：目标、可用时间、哪一天，三项就够。
 *    计划的质量靠后端喂进去的骑行数据，而不是靠用户填表。
 */

/** 目标快捷选项：点一下填进输入框（还可以再改），省去从零打字 */
const GOAL_PRESETS = ['保持状态', '提升耐力', '爬坡专项', '间歇刺激', '轻松恢复']

/** 可用时间快捷选项（分钟）；null = 不限 */
const MINUTE_PRESETS: { label: string; value: number | null }[] = [
  { label: '30 分钟', value: 30 },
  { label: '45 分钟', value: 45 },
  { label: '1 小时', value: 60 },
  { label: '90 分钟', value: 90 },
  { label: '不限', value: null },
]

/** 强度档位 → 配色。恢复/轻松是"温和"，间歇是"最烈"，颜色如实表达强度 */
const INTENSITY_TONE: Record<string, string> = {
  恢复: 'border-accent-emerald/40 bg-accent-emerald/10 text-accent-emerald-text',
  轻松: 'border-accent-emerald/40 bg-accent-emerald/10 text-accent-emerald-text',
  耐力: 'border-accent-sky/40 bg-accent-sky/10 text-accent-sky-text',
  节奏: 'border-accent-amber/40 bg-accent-amber/10 text-accent-amber-text',
  阈值: 'border-accent-amber/40 bg-accent-amber/10 text-accent-amber-text',
  间歇: 'border-accent-red/40 bg-accent-red/10 text-accent-red-text',
}

function intensityTone(intensity: string): string {
  return INTENSITY_TONE[intensity] ?? 'border-accent-sky/40 bg-accent-sky/10 text-accent-sky-text'
}

export default function TrainingPlanCard() {
  const { isAdmin } = useAuth()
  const { phase, result, error, generate } = useTrainingPlan(isAdmin)

  const [goal, setGoal] = useState('')
  const [minutes, setMinutes] = useState<number | null>(60)
  const [day, setDay] = useState<'today' | 'tomorrow'>('today')

  if (!isAdmin) return null
  // 正在查 / 功能不可用：整块不渲染。给一个点了报错的按钮比不显示更糟
  if (phase === 'checking' || phase === 'unavailable') return null

  const plan = result?.plan ?? null
  const loading = phase === 'loading'

  const submit = () => {
    const inputs: PlanRequest = { goal: goal.trim() || undefined, minutes: minutes ?? undefined, day }
    void generate(inputs)
  }

  return (
    <section className="card">
      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold tracking-wide text-t2">
        <CalendarClock className="h-4 w-4 shrink-0 text-accent-emerald" aria-hidden="true" />
        <span>训练计划</span>
        {result && (
          <span className="text-xs font-normal text-t4">
            {result.source === 'model' &&
              (result.cached
                ? `${result.model} · 来自缓存（未重复调用）`
                : `${result.model} · 耗时 ${(result.durationMs / 1000).toFixed(1)}s · ${
                    (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0)
                  } tokens`)}
          </span>
        )}
        {result && !loading && (
          <button
            type="button"
            onClick={submit}
            className="ml-auto flex items-center gap-1 text-xs font-normal text-t3 transition hover:text-t1"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            重新生成
          </button>
        )}
      </div>

      {/* ============ 输入区：三项就够 ============ */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <p className="mb-1.5 text-[11px] text-t4">计划哪一天</p>
            <div
              className="grid w-36 grid-cols-2 gap-1 rounded-lg border border-line bg-fill p-1"
              role="tablist"
              aria-label="计划哪一天"
            >
              {(['today', 'tomorrow'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={day === value}
                  onClick={() => setDay(value)}
                  className={`rounded-md px-2 py-1 text-xs transition ${
                    day === value ? 'bg-surface font-medium text-t1 shadow-sm' : 'text-t3 hover:text-t1'
                  }`}
                >
                  {value === 'today' ? '今天' : '明天'}
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-0">
            <p className="mb-1.5 text-[11px] text-t4">可用时间</p>
            <div className="flex flex-wrap gap-1.5">
              {MINUTE_PRESETS.map((preset) => {
                const active = minutes === preset.value
                return (
                  <button
                    key={preset.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setMinutes(preset.value)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                      active
                        ? 'border-accent-sky/50 bg-accent-sky/10 text-accent-sky-text'
                        : 'border-line bg-fill text-t3 hover:text-t1'
                    }`}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] text-t4" htmlFor="plan-goal">
            目标 / 个人计划（可留空）
          </label>
          <input
            id="plan-goal"
            type="text"
            value={goal}
            maxLength={200}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="例如：下个月想完成一次百公里"
            className="field-input"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {GOAL_PRESETS.map((preset) => {
              const active = goal === preset
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setGoal(active ? '' : preset)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                    active
                      ? 'border-accent-emerald/50 bg-accent-emerald/10 text-accent-emerald-text'
                      : 'border-line bg-fill text-t3 hover:text-t1'
                  }`}
                >
                  {preset}
                </button>
              )
            })}
          </div>
        </div>

        <button type="button" onClick={submit} disabled={loading} className="btn-primary w-full">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              正在生成计划…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {result ? '按当前设置重新生成' : '生成计划'}
            </>
          )}
        </button>

        {phase === 'idle' && (
          <p className="text-xs leading-5 text-t4">
            会结合最近一次骑行的距离、速度、爬升与评分，以及近 7 天的训练量，规划这一天的骑行安排。
            同样的设置重复查看不会重复调用模型。
          </p>
        )}
      </div>

      {/* ============ 降级说明：如实标注，不冒充 AI ============ */}
      {result?.source === 'fallback' && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-accent-amber/30 bg-accent-amber/10 px-3 py-2 text-xs leading-5 text-accent-amber-text">
          <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            AI 暂不可用{result.fallbackReason ? `（${result.fallbackReason}）` : ''}，下面是
            <span className="font-medium">规则兜底的保守计划</span>
            —— 等 AI 恢复后重新生成，可以得到贴合目标的安排。
          </span>
        </p>
      )}

      {phase === 'error' && (
        <div className="mt-4 space-y-2">
          <p className="flex items-start gap-2 rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs leading-5 text-accent-red-text">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
          <button
            type="button"
            onClick={submit}
            className="flex items-center gap-1 text-xs text-t3 transition hover:text-t1"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            重试
          </button>
        </div>
      )}

      {/* ============ 计划正文 ============ */}
      {plan && phase !== 'loading' && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2/70 px-4 py-3">
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${intensityTone(plan.intensity)}`}
            >
              {plan.intensity}
            </span>
            <span className="min-w-0 text-sm leading-6 text-t1">{plan.headline}</span>
          </div>

          {/* 骑行量四格：数字用等宽字形，不随内容跳动 */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="stat-tile">
              <div className="stat-value tnum">
                {plan.distanceKm}
                <span className="stat-unit">km</span>
              </div>
              <div className="stat-label">建议距离</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value tnum">
                {plan.durationMin}
                <span className="stat-unit">分钟</span>
              </div>
              <div className="stat-label">建议时长</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value tnum">
                {plan.speedRange}
                <span className="stat-unit">km/h</span>
              </div>
              <div className="stat-label">目标均速</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value tnum">
                {plan.elevationM == null ? '—' : plan.elevationM}
                {plan.elevationM != null && <span className="stat-unit">m</span>}
              </div>
              <div className="stat-label">建议爬升</div>
            </div>
          </div>

          <div>
            <h4 className="mb-1.5 text-xs font-medium text-t3">分段安排</h4>
            <ul className="space-y-2">
              {plan.structure.map((phaseItem, index) => (
                <li key={`${phaseItem.name}-${index}`} className="flex gap-3 text-xs leading-5">
                  <span className="w-10 shrink-0 pt-px text-right font-medium text-t2">{phaseItem.name}</span>
                  <span className="w-14 shrink-0 pt-px">
                    <span className="tnum rounded bg-fill-strong px-1.5 py-0.5 text-[10px] text-t3">
                      {phaseItem.durationMin} 分
                    </span>
                  </span>
                  <span className="min-w-0 text-t3">{phaseItem.detail}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-1.5 text-xs font-medium text-t3">为什么这么安排</h4>
            <ul className="space-y-1.5">
              {plan.reasons.map((line) => (
                <li key={line} className="flex gap-2 text-xs leading-5 text-t3">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent-emerald" aria-hidden="true" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {plan.cautions.length > 0 && (
            <ul className="space-y-1.5">
              {plan.cautions.map((line) => (
                <li
                  key={line}
                  className="flex gap-2 rounded-lg border border-accent-amber/30 bg-accent-amber/10 px-3 py-2 text-xs leading-5 text-accent-amber-text"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}

          {result?.source === 'model' && (
            <p className="text-[11px] leading-5 text-t5">
              计划由 AI 结合你的骑行数据生成，供参考；身体不适时以恢复为先。
            </p>
          )}
        </div>
      )}
    </section>
  )
}
