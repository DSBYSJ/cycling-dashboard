import { useEffect } from 'react'

/**
 * 卡片辉光：把指针位置写进卡片自己的 CSS 变量（--mx/--my），由 index.css 的
 * .card::after 渲染成一枚跟随鼠标的光斑。
 *
 * 两个"不卡顿"的关键：
 * 1. 只在 document 上挂 **一个** 监听器（事件委托），不给每张卡片单独绑定；
 * 2. 高频 mousemove 经 rAF 节流，并且只写 CSS 变量 —— 不经过 React 状态，
 *    不会触发任何重渲染。
 *
 * 触屏设备（粗指针）直接不启用：那里没有"跟随鼠标"这回事。
 */
export function useCardSpotlight() {
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    if (window.matchMedia('(pointer: coarse)').matches) return

    let raf = 0
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const target = e.target as HTMLElement | null
        const card = target?.closest?.('.card') as HTMLElement | null
        if (!card) return
        const rect = card.getBoundingClientRect()
        card.style.setProperty('--mx', `${e.clientX - rect.left}px`)
        card.style.setProperty('--my', `${e.clientY - rect.top}px`)
      })
    }

    document.addEventListener('mousemove', onMove, { passive: true })
    return () => {
      document.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])
}
