import { useEffect, useRef, useState } from 'react'

/** 系统是否要求减弱动效（此时数字直接跳到目标值） */
function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 数字滚动：值变化时用 requestAnimationFrame 从当前显示值滚到目标值。
 *
 * - 初次挂载从 0 滚上去，让"分数出现"有个仪式感；
 * - 换记录（值变化）时从旧值滚到新值，而不是瞬间跳变；
 * - 系统开启「减弱动效」时直接显示目标值，不跑动画。
 *
 * 只更新一个数字的 state，每帧一次 —— 不引起列表或图表重算。
 */
export function useCountUp(target: number, duration = 560) {
  const [display, setDisplay] = useState(() => (prefersReducedMotion() ? target : 0))
  const fromRef = useRef(prefersReducedMotion() ? target : 0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const from = fromRef.current
    if (from === target || prefersReducedMotion()) {
      fromRef.current = target
      setDisplay(target)
      return
    }

    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic：先快后慢，收尾稳
      setDisplay(Math.round(from + (target - from) * eased))
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      fromRef.current = target
    }
  }, [target, duration])

  return display
}
