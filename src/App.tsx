import { useEffect, useState } from 'react'
import AboutPage from './components/AboutPage'
import AuthPage from './components/auth/AuthPage'
import Dashboard from './components/Dashboard'
import { useAuth } from './hooks/useAuth'

/**
 * 应用入口：只负责「路由 + 登录态分流」。
 *
 *   #/about       → 公开页（不需要登录，见下）
 *   checking      → 正在问后端「Cookie 里的会话还有效吗」，显示过渡页
 *   anonymous     → 登录/注册页
 *   authenticated → 主界面
 *
 * 主界面拆成独立的 Dashboard 组件，是为了让它的数据 hooks **只在已登录时才挂载** ——
 * 否则未登录状态下也会去拉数据（必然 401）。同时这也是 Hooks 规则要求的：
 * 不能在同一个组件里按条件调用 hooks。
 */

/** 读取 hash（SSR / 测试环境下没有 window） */
function readHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

/**
 * 是否是公开的「关于本站」页（`#/about`）。
 *
 * 单独判断而不并入 useTabRoute，是因为 TabId 是"登录进来之后"的概念，
 * 而这一页恰恰要在没有登录态时也能打开 —— 把它塞进分页体系只会让两边都别扭。
 */
function useIsAboutRoute(): boolean {
  const [hash, setHash] = useState(readHash)

  useEffect(() => {
    const onHashChange = () => setHash(readHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return /^#\/?about\/?$/.test(hash)
}

function BootScreen() {
  return (
    <div className="flex min-h-full items-center justify-center bg-page">
      <div className="flex flex-col items-center gap-2 text-t4" role="status" aria-live="polite">
        <span className="text-2xl" aria-hidden="true">
          🚴
        </span>
        <span className="text-xs">正在连接服务器…</span>
      </div>
    </div>
  )
}

export default function App() {
  const { status } = useAuth()
  const isAbout = useIsAboutRoute()

  // 公开页排在最前面，有两个原因：
  //   1. 访客不该先看一屏「正在连接服务器」再看到内容
  //   2. 后端不可用时这一页也要能打开 —— 它是站点的门面，不依赖接口
  if (isAbout) return <AboutPage />

  if (status === 'checking') return <BootScreen />
  if (status === 'anonymous') return <AuthPage />
  return <Dashboard />
}
