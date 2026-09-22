import AuthPage from './components/auth/AuthPage'
import Dashboard from './components/Dashboard'
import { useAuth } from './hooks/useAuth'

/**
 * 应用入口：只负责「登录态分流」。
 *
 *   checking      → 正在问后端「Cookie 里的会话还有效吗」，显示过渡页
 *   anonymous     → 登录/注册页
 *   authenticated → 主界面
 *
 * 主界面拆成独立的 Dashboard 组件，是为了让它的数据 hooks **只在已登录时才挂载** ——
 * 否则未登录状态下也会去拉数据（必然 401）。同时这也是 Hooks 规则要求的：
 * 不能在同一个组件里按条件调用 hooks。
 */

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

  if (status === 'checking') return <BootScreen />
  if (status === 'anonymous') return <AuthPage />
  return <Dashboard />
}
