import { useEffect, type RefObject } from 'react'

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** smoothstep：在 [a, b] 区间内做 S 形过渡，区间外恒为 0 或 1 —— 分段插值的基本砖块 */
function smoothstep(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/**
 * 把元素的「滚出进度」写入 CSS 变量，由 CSS 做插值 —— 展示页 hero 的滚动退场。
 *
 * 两个变量（写元素自身的 style，不经过 React）：
 *  - `--hero-p`：0→1 的原始进度（元素顶部离开视口顶端的比例），用于视差漂移；
 *  - `--hero-q`：**分段插值**后的退出量 —— 前 45% 保持不动，之后才进入退场过渡。
 *    这正是 deepseecommerce 那种「进 → 保持 → 退」节奏的复现：滚动映射不做全程线性，
 *    分几段处理，效果才会"该稳的时候稳、该动的时候动"。
 *
 * 方向感知：进度由当前滚动位置反推（不是一次性触发的动画），往回滚会**原路退回去**，
 * 这也是它比"一次性入场"更耐看的原因。
 *
 * 性能：passive 监听 + rAF 节流（每帧最多一次布局读取）；只写两个 CSS 变量，
 * 不触发任何 React 重渲染。「减弱动效」下直接不注册，变量保持 0（= 无效果）。
 */
export function useScrollExit(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let raf = 0
    const update = () => {
      raf = 0
      const rect = el.getBoundingClientRect()
      const height = rect.height || 1
      const p = clamp01(-rect.top / height)
      const q = smoothstep(0.45, 0.95, p)
      el.style.setProperty('--hero-p', p.toFixed(4))
      el.style.setProperty('--hero-q', q.toFixed(4))
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
      el.style.removeProperty('--hero-p')
      el.style.removeProperty('--hero-q')
    }
  }, [ref])
}
