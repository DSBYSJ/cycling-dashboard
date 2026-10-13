import { useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'

/**
 * 返回顶部：右下角一枚带滚动进度环的圆形按钮。
 *
 * - 滚动超过一屏多一点（480px）才浮现，平时不干扰内容；
 * - 外圈进度环实时反映「已经滚了全文的多少」（--p 写入 CSS 变量，
 *   rAF 节流 + passive 监听，每帧最多一次 setState）；
 * - 点击平滑回顶；系统「减弱动效」下 scroll-behavior 已被全局规则压为 auto，
 *   功能保留、只是不再平滑，符合降级约定；
 * - 显示 / 隐藏只动 transform/opacity（见 index.css 的 .back-top）。
 */
export default function BackToTop() {
  const [visible, setVisible] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const rafRef = useRef(0)

  useEffect(() => {
    const update = () => {
      rafRef.current = 0
      const doc = document.documentElement
      const max = doc.scrollHeight - window.innerHeight
      const p = max > 0 ? Math.min(1, window.scrollY / max) : 0
      // 进度写 CSS 变量，不进 React 状态 —— 滚动中不触发组件重渲染
      btnRef.current?.style.setProperty('--p', p.toFixed(4))
      setVisible((prev) => {
        const next = window.scrollY > 480
        return prev === next ? prev : next
      })
    }
    const onScroll = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <button
      ref={btnRef}
      type="button"
      className={`back-top${visible ? ' is-visible' : ''}`}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="返回顶部"
      title="返回顶部"
      // 隐藏时也要从 Tab 序列里拿掉，不能只靠 pointer-events
      tabIndex={visible ? 0 : -1}
    >
      <svg className="back-top-ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle className="track" cx="18" cy="18" r="16" />
        <circle className="prog" cx="18" cy="18" r="16" pathLength={1} />
      </svg>
      <ArrowUp className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}
