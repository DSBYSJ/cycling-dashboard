import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'cycling-dashboard:theme'

function readSaved(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // localStorage 不可用时忽略
  }
  return 'dark' // 应用默认深色（夜间）主题
}

/** 应用到 <html>:data-theme 驱动 CSS 变量,color-scheme 让原生控件(日期选择器等)跟随 */
function applyToDocument(theme: Theme) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
}

let current: Theme = readSaved()
const listeners = new Set<(theme: Theme) => void>()

applyToDocument(current)

export function setTheme(theme: Theme, opts: { animate?: boolean } = {}) {
  const { animate = true } = opts
  current = theme
  const root = document.documentElement
  // 切换瞬间给 <html> 挂上过渡类：色彩平滑过渡 320ms，而不是整页"啪"地换色。
  // 只在切换期间挂载 —— 长期挂在所有元素上会让滚动/交互变重。
  // ⚠️ 走 View Transition（圆形揭示）时必须关掉它：底层的颜色过渡会与快照动画叠加，
  // 还可能让"新视图快照"抓到过渡中间态。
  if (animate) {
    root.classList.add('theme-anim')
    window.setTimeout(() => root.classList.remove('theme-anim'), 360)
  } else {
    root.classList.remove('theme-anim')
  }
  applyToDocument(theme)
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // 忽略持久化失败
  }
  listeners.forEach((listener) => listener(theme))
}

export function getTheme(): Theme {
  return current
}

/** 主题揭示动画的圆心（一般是点击按钮时的坐标） */
export interface RevealOrigin {
  x: number
  y: number
}

/** View Transitions 的最小类型（够用就好；不支持该 API 的浏览器拿不到这个字段） */
type ViewTransitionDoc = {
  startViewTransition?: (cb: () => void) => { ready: Promise<unknown>; finished: Promise<unknown> }
}

let revealInFlight = false

/**
 * 带"圆形揭示"的主题切换：从点击处扩散一枚圆，把新主题像换皮肤一样铺满全屏。
 *
 * 用的是 View Transitions API —— 浏览器给新旧两帧各拍一张快照，我们在
 * `::view-transition-new(root)` 上跑 clip-path 圆扩散；旧视图静态垫底，
 * 圆的边缘扫过哪里，哪里就切换成新主题。
 *
 * 回退链：不支持该 API / 系统开了「减弱动效」/ 没拿到点击坐标 → 普通切换
 * （theme-anim 的 320ms 颜色过渡，行为与旧版一致）。
 */
export function toggleThemeAt(origin?: RevealOrigin) {
  const next: Theme = current === 'dark' ? 'light' : 'dark'
  const doc = document as unknown as ViewTransitionDoc
  const reduced =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // 上一次揭示还没放完就又点：直接切，别叠动画
  if (!doc.startViewTransition || reduced || !origin || revealInFlight) {
    setTheme(next)
    return
  }
  const { x, y } = origin
  // 圆要盖满全屏：取点击点到最远角落的距离
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  const vt = doc.startViewTransition(() => setTheme(next, { animate: false }))
  revealInFlight = true
  void vt.finished.then(
    () => {
      revealInFlight = false
    },
    () => {
      revealInFlight = false
    }
  )
  void vt.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: 520,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          pseudoElement: '::view-transition-new(root)',
        } as unknown as KeyframeAnimationOptions
      )
    })
    .catch(() => {
      // 快照失败不影响主题本身，已经切好了
    })
}

/**
 * 主题(HUD 明暗/昼夜)状态。模块级共享,任何组件调用都会同步到同一个值,
 * 因此地图等独立组件也能随全局切换即时更新。
 */
export function useTheme() {
  const [theme, setLocal] = useState<Theme>(current)

  useEffect(() => {
    const listener = (next: Theme) => setLocal(next)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  return {
    theme,
    setTheme,
    /** 切换明暗；传入点击坐标时使用"圆形揭示"动效（见 toggleThemeAt） */
    toggle: (origin?: RevealOrigin) => toggleThemeAt(origin),
  }
}
