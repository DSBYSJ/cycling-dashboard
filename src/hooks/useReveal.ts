import { useEffect } from 'react'

/** 系统是否要求减弱动效 */
function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 滚动揭示：页面里的元素随着滚动进入视口时淡入上浮。
 *
 * 给元素加 `data-reveal` 即可（可选 `style={{ '--i': n }}` 做同组错峰）。
 *
 * 两个"不卡顿"的关键：
 * 1. 用 IntersectionObserver 而不是监听 scroll —— 滚动线程不做任何计算；
 * 2. 只加一个 class（由 CSS 负责动效），进入视口后立即 unobserve，不再回放。
 *
 * 「减弱动效」下全部直接置为可见，不做动画。
 */
export function useRevealOnScroll() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (nodes.length === 0) return

    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      nodes.forEach((n) => n.classList.add('is-revealed'))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed')
            observer.unobserve(entry.target)
          }
        })
      },
      // 元素露出约 12% 时触发，避免"刚碰到边缘就播完"
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    )
    nodes.forEach((n) => observer.observe(n))
    return () => observer.disconnect()
  }, [])
}

/**
 * 顶部阅读进度：返回 0–1 的滚动比例。
 * 用 passive 监听 + rAF 节流，滚动过程中不做布局读取以外的任何计算。
 */
export function useReadingProgress(onChange: (ratio: number) => void) {
  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = 0
      const doc = document.documentElement
      const max = doc.scrollHeight - doc.clientHeight
      onChange(max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0)
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
      cancelAnimationFrame(raf)
    }
  }, [onChange])
}
