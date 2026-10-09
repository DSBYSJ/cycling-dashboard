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

export function setTheme(theme: Theme) {
  current = theme
  // 切换瞬间给 <html> 挂上过渡类：色彩平滑过渡 320ms，而不是整页"啪"地换色。
  // 只在切换期间挂载 —— 长期挂在所有元素上会让滚动/交互变重。
  const root = document.documentElement
  root.classList.add('theme-anim')
  window.setTimeout(() => root.classList.remove('theme-anim'), 360)
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
    toggle: () => setTheme(current === 'dark' ? 'light' : 'dark'),
  }
}
