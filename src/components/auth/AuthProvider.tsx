import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api, type PublicUser } from '../../api/client'
import { AuthContext, userKeyOf, type AuthContextValue, type AuthStatus } from '../../hooks/useAuth'

/** 把后端/网络的异常转成给用户看的一句话 */
function describeError(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) return err.message
  return String(err)
}

/**
 * 登录态的唯一来源。
 *
 * 关键设计：**登录态存在 httpOnly Cookie 里，前端不持有令牌**。
 * 所以「我是否已登录」只能问后端（`/api/auth/me`）——
 * 好处是刷新页面不会掉登录，坏处是首屏要多一次请求。这个代价值得。
 */
export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 启动时确认登录态：Cookie 里若还有有效会话，刷新页面应该直接进主界面
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const { user: me } = await api.me()
        if (!alive) return
        setUser(me)
        setStatus('authenticated')
      } catch (err) {
        if (!alive) return
        setStatus('anonymous')
        // 401 是「未登录」的正常情况，不该提示；只有连不上服务器才值得说一句
        if (!(err instanceof ApiError)) setNotice('暂时无法连接服务器，请检查网络')
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  /** 任何数据请求只要返回 401，就说明会话没了 —— 统一踢回登录页 */
  const handleAuthFailure = useCallback((err: unknown): boolean => {
    if (err instanceof ApiError && err.isAuthFailure) {
      setUser(null)
      setStatus('anonymous')
      setNotice('登录已过期，请重新登录')
      return true
    }
    return false
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const { user: me } = await api.login(email.trim(), password)
      setUser(me)
      setStatus('authenticated')
      return true
    } catch (err) {
      setError(describeError(err))
      return false
    } finally {
      setSubmitting(false)
    }
  }, [])

  const register = useCallback(async (email: string, password: string) => {
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const { user: me } = await api.register(email.trim(), password)
      setUser(me)
      setStatus('authenticated')
      return true
    } catch (err) {
      setError(describeError(err))
      return false
    } finally {
      setSubmitting(false)
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      // 退出接口失败也要把本地状态清掉，否则界面会卡在「已登录」但什么都干不了
    }
    setUser(null)
    setStatus('anonymous')
    setNotice(null)
    setError(null)
  }, [])

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      setSubmitting(true)
      try {
        await api.changePassword(currentPassword, newPassword)
      } catch (err) {
        // 改密的失败原因要在设置面板里提示，同时把会话失效也接住
        if (!handleAuthFailure(err)) throw err
      } finally {
        setSubmitting(false)
      }
    },
    [handleAuthFailure]
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      error,
      notice,
      submitting,
      login,
      register,
      logout,
      changePassword,
      clearError,
      handleAuthFailure,
      userKey: userKeyOf(user),
    }),
    [user, status, error, notice, submitting, login, register, logout, changePassword, clearError, handleAuthFailure]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
