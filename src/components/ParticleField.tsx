import { useEffect, useRef } from 'react'

/**
 * 星场粒子背景（Canvas 2D）。
 *
 * 用在「展示型」页面（登录页 / 关于页），和应用内容页区分开 —— 内容页要专注，
 * 且少一层常驻绘制就少一份耗电。
 *
 * 性能约定（这是它敢常驻的前提）：
 * 1. 粒子数按视口宽度分档：窄屏 34 / 宽屏 74，封顶 74；
 * 2. DPR 封顶 2 —— 4K 屏上不追物理分辨率，视觉几乎无差别、像素量却少一半；
 * 3. 连线是 O(n²)，n ≤ 74 → 每帧最多 ~2700 次距离判断，可忽略不计；
 * 4. 页面切到后台（visibilitychange）立刻停帧，回来再续；
 * 5. `prefers-reduced-motion` 下**不启动** —— 保持静态背景即可。
 *
 * 交互：指针靠近时粒子被轻微吸引（半径 150px 内），松手即散开 —— 不抢操作、纯氛围。
 */
export default function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 减弱动效：不启动动画循环
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let width = 0
    let height = 0
    let dpr = 1
    let raf = 0
    let running = true
    const pointer = { x: -9999, y: -9999 }

    /** 主题色从 CSS 变量读取：换主题时跟着换，不写死色值 */
    let tint = '56 189 248'

    interface Dot {
      x: number
      y: number
      vx: number
      vy: number
      r: number
    }
    let dots: Dot[] = []

    const readTint = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--c-sky-rgb').trim()
      if (v) tint = v
    }

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const count = width < 768 ? 34 : 74
      dots = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.4 + 0.6,
      }))
    }

    const LINK_DIST = 118
    const PULL_RADIUS = 150

    const frame = () => {
      if (!running) return
      ctx.clearRect(0, 0, width, height)

      for (const d of dots) {
        // 指针轻吸引
        const dx = pointer.x - d.x
        const dy = pointer.y - d.y
        const dist2 = dx * dx + dy * dy
        if (dist2 < PULL_RADIUS * PULL_RADIUS && dist2 > 1) {
          const dist = Math.sqrt(dist2)
          d.vx += (dx / dist) * 0.012
          d.vy += (dy / dist) * 0.012
        }

        // 限速（避免被指针拉成一条线）并保持整体缓慢漂移
        const speed = Math.hypot(d.vx, d.vy)
        if (speed > 0.6) {
          d.vx = (d.vx / speed) * 0.6
          d.vy = (d.vy / speed) * 0.6
        }
        d.vx *= 0.995
        d.vy *= 0.995

        d.x += d.vx
        d.y += d.vy

        // 回到视野内（回绕而非反弹，星场感更强）
        if (d.x < -10) d.x = width + 10
        else if (d.x > width + 10) d.x = -10
        if (d.y < -10) d.y = height + 10
        else if (d.y > height + 10) d.y = -10
      }

      // 连线（距离越近越亮）
      ctx.lineWidth = 1
      for (let i = 0; i < dots.length; i++) {
        const a = dots[i]
        for (let j = i + 1; j < dots.length; j++) {
          const b = dots[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const dist2 = dx * dx + dy * dy
          if (dist2 > LINK_DIST * LINK_DIST) continue
          const alpha = (1 - Math.sqrt(dist2) / LINK_DIST) * 0.22
          ctx.strokeStyle = `rgba(${tint} / ${alpha})`
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }

      // 粒子
      for (const d of dots) {
        ctx.fillStyle = `rgba(${tint} / 0.55)`
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }

      raf = requestAnimationFrame(frame)
    }

    const onPointerMove = (e: PointerEvent) => {
      pointer.x = e.clientX
      pointer.y = e.clientY
    }
    const onPointerLeave = () => {
      pointer.x = -9999
      pointer.y = -9999
    }
    const onVisibility = () => {
      if (document.hidden) {
        running = false
        cancelAnimationFrame(raf)
      } else if (!running) {
        running = true
        raf = requestAnimationFrame(frame)
      }
    }
    const onThemeChange = () => readTint()

    readTint()
    resize()
    raf = requestAnimationFrame(frame)

    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerleave', onPointerLeave)
    document.addEventListener('visibilitychange', onVisibility)
    // 主题切换时重读取色（MutationObserver 只在 data-theme 变化时触发一次）
    const themeObserver = new MutationObserver(onThemeChange)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerleave', onPointerLeave)
      document.removeEventListener('visibilitychange', onVisibility)
      themeObserver.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="particle-field" aria-hidden="true" />
}
