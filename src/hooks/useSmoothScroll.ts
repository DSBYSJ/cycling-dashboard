import { useEffect } from 'react'

/** 系统是否要求减弱动效 */
function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 平滑滚动（惯性滚动）—— 仅展示页启用。
 *
 * 把滚轮的离散跳动改造成带惯性的连续位移。这是「高级感」里感知最强、
 * 成本最低的一环：滚动本身顺了，其余滚动联动的动效才有从容的观感。
 *
 * 三条边界：
 * 1. **动态加载**（`import('lenis')`）—— 只有展示页用得到，不进主包；
 * 2. 触摸设备不接管（`syncTouch: false`）—— 手机保持系统原生滚动手感；
 * 3. 「减弱动效」下**完全不初始化** —— 开了这个开关的用户要的就是"别动"。
 *
 * Lenis 平滑的是**真实滚动位置**（逐帧逼近 + window 滚动），
 * 因此现有依赖 scroll 事件的逻辑（阅读进度、滚动揭示、hero 退场）完全不受影响。
 */
export function useSmoothScroll() {
  useEffect(() => {
    if (typeof window === 'undefined' || prefersReducedMotion()) return

    let disposed = false
    let raf = 0
    let destroy: (() => void) | undefined

    void import('lenis').then(({ default: Lenis }) => {
      if (disposed) return
      const lenis = new Lenis({ lerp: 0.09, smoothWheel: true, syncTouch: false })
      const loop = (time: number) => {
        lenis.raf(time)
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
      destroy = () => {
        cancelAnimationFrame(raf)
        lenis.destroy()
      }
    })

    return () => {
      disposed = true
      destroy?.()
    }
  }, [])
}
