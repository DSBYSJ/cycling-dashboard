import { AlertTriangle, Bot, Loader2, RefreshCw, Target } from 'lucide-react'
import type { RideRecord } from '../types'
import { useAuth } from '../hooks/useAuth'
import { useCoachReview } from '../hooks/useCoachReview'
import RidePicker from './RidePicker'

/**
 * AI 教练复盘卡片。
 *
 * ⚠️ **只对管理员（站长本人）渲染**，这是合规要求，不是体验取舍：
 * 个人主体 ICP 备案不能面向公众提供生成式 AI 服务（大模型服务登记的申报主体
 * 必须是境内法人）。后端已经用权限钩子拦住了接口，这里再挡一层 ——
 * 因为组件比接口更容易被将来"顺手复用到别处"。
 *
 * 另外两条原则：
 * 1. **降级必须说清楚**：模型不可用时展示规则引擎已有的建议，并明确标注这不是 AI 生成的。
 *    冒充 AI 比没有 AI 更糟 —— 用户会以为"AI 就这水平"，实际是企业/服务出了问题。
 * 2. **不做导出与分享**：一份可对外传播的 AI 生成内容，性质上更接近"向公众提供 AI 服务"。
 */

interface Props {
  record: RideRecord
  /**
   * 可切换的记录列表（传全部记录）。
   * 历史列表在「看板」页，而这张卡片在「记录」页 —— 没有它就得来回切页才能换一条复盘。
   */
  rides?: RideRecord[]
  onSelectRide?: (id: string) => void
}

export default function CoachReviewCard({ record, rides, onSelectRide }: Props) {
  const { isAdmin } = useAuth()
  // 非管理员传 null：hook 直接进入 unavailable，不会发出任何请求
  const { phase, result, error, generate } = useCoachReview(isAdmin ? record.id : null)

  if (!isAdmin) return null
  // 正在查 / 功能不可用：整块不渲染。给一个点了报错的按钮比不显示更糟
  if (phase === 'checking' || phase === 'unavailable') return null

  const review = result?.review ?? null

  return (
    <section className="card">
      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold tracking-wide text-t2">
        <Bot className="h-4 w-4 shrink-0 text-accent-sky-text" aria-hidden="true" />
        <span>AI 教练复盘</span>
        {phase === 'ready' && result && (
          <span className="text-xs font-normal text-t4">
            {result.model}
            {result.cached
              ? ' · 来自缓存（未重复调用）'
              : ` · 耗时 ${(result.durationMs / 1000).toFixed(1)}s · ${
                  (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0)
                } tokens`}
          </span>
        )}
        {(phase === 'ready' || phase === 'fallback' || phase === 'error') && (
          <button
            type="button"
            onClick={() => void generate()}
            className="ml-auto flex items-center gap-1 text-xs font-normal text-t3 transition hover:text-t1"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            重新生成
          </button>
        )}
      </div>

      {/*
        换个记录复盘：历史列表在「看板」页，而这张卡片在「记录」页 ——
        没有它就得「切过去点一下、再切回来」。切换后上方的「本次评分」也会跟着变
        （两者共用同一个 selected），所以标签写「复盘对象」，如实说明它会换掉整页的对象。
      */}
      {rides && onSelectRide && (
        <div className="mb-4">
          <RidePicker rides={rides} selectedId={record.id} onSelect={onSelectRide} label="复盘对象" />
        </div>
      )}

      {phase === 'idle' && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => void generate()}
            className="w-full rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-t1 transition hover:bg-fill-strong"
          >
            用 AI 复盘这次骑行
          </button>
          <p className="text-xs leading-5 text-t4">
            会结合本次的距离、速度、爬升、天气，以及最近几次的记录做对比，给出针对性的训练建议。
            同一份数据重复查看不会重复调用模型。
          </p>
        </div>
      )}

      {phase === 'loading' && (
        <div className="flex h-24 items-center justify-center gap-2 text-sm text-t4">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          正在生成复盘…
        </div>
      )}

      {phase === 'ready' && review && (
        <div className="space-y-3">
          <p className="rounded-lg border border-line bg-surface-2/70 px-4 py-3 text-sm leading-6 text-t1">
            {review.summary}
          </p>

          {review.risk && (
            <p className="flex gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs leading-5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-amber-text" aria-hidden="true" />
              <span className="text-accent-amber-text">{review.risk}</span>
            </p>
          )}

          {review.highlights.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-medium text-t3">做得好的</h4>
              <ul className="space-y-1.5">
                {review.highlights.map((item, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-5 text-t3">
                    <span className="text-accent-emerald-text" aria-hidden="true">
                      ✓
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h4 className="mb-1.5 text-xs font-medium text-t3">可以改进</h4>
            <ul className="space-y-2">
              {review.improvements.map((item, i) => (
                <li key={i} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs leading-5">
                  <span className="font-medium text-t1">{item.point}</span>
                  <span className="text-t3">：{item.how}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs leading-5 text-t2">
            <Target className="h-3.5 w-3.5 shrink-0 text-accent-sky-text" aria-hidden="true" />
            <span>下次目标：{review.nextGoal}</span>
          </p>

          <p className="text-[11px] leading-5 text-t5">
            由 AI 根据本次记录生成，仅供参考。送入模型的上下文 {result?.promptChars ?? 0} 字 ——
            原始轨迹点未直接送入。
          </p>
        </div>
      )}

      {phase === 'fallback' && (
        <div className="space-y-3">
          <p className="flex gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs leading-5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-amber-text" aria-hidden="true" />
            <span className="text-accent-amber-text">
              这次没能拿到 AI 复盘（{result?.fallbackReason ?? '模型暂时不可用'}）。
              以下是本站规则引擎给出的评价与建议，<strong className="font-medium">不是 AI 生成的</strong>
              —— 评分与建议本身不受影响。
            </span>
          </p>
          {result && (
            <>
              <p className="rounded-lg border border-line bg-surface-2/70 px-4 py-3 text-sm leading-6 text-t1">
                {result.fallback.comment}
              </p>
              {result.fallback.suggestions.length > 0 && (
                <ul className="space-y-1.5">
                  {result.fallback.suggestions.map((item, i) => (
                    <li key={i} className="flex gap-2 text-xs leading-5 text-t3">
                      <span className="text-accent-amber" aria-hidden="true">
                        ▲
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-3">
          <p className="flex gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs leading-5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-amber-text" aria-hidden="true" />
            <span className="text-accent-amber-text">{error ?? '生成失败，请稍后重试'}</span>
          </p>
          <button
            type="button"
            onClick={() => void generate()}
            className="w-full rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-sm text-t1 transition hover:bg-fill-strong"
          >
            重试
          </button>
        </div>
      )}
    </section>
  )
}
