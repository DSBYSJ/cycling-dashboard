import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api, type MeResult, type PublicUser } from '../../api/client'
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
  const [isAdmin, setIsAdmin] = useState(false)
  const [feedbackEnabled, setFeedbackEnabled] = useState(false)
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  /** 登录、注册、查询当前用户返回同一套信息，统一在这里落盘 */
  const applyIdentity = useCallback((me: MeResult) => {
    setUser(me.user)
    setIsAdmin(me.isAdmin)
    setFeedbackEnabled(me.feedbackEnabled)
  }, [])

  const forgetIdentity = useCallback(() => {
    setUser(null)
    setIsAdmin(false)
    setFeedbackEnabled(false)
  }, [])

  // 启动时确认登录态：Cookie 里若还有有效会话，刷新页面应该直接进主界面
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const me = await api.me()
        if (!alive) return
        applyIdentity(me)
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
  }, [applyIdentity])

  const clearError = useCallback(() => setError(null), [])

  /**
   * 任何数据请求遇到「登录态有问题」就统一踢回登录页。
   *
   * 除了 401，这里还接住 403 account_disabled —— 账号被站长停用后，
   * 用户手上的会话会立刻失效（后端每次请求都会回查状态），
   * 这时候要明确告诉他原因，而不是让他对着一个"操作失败"发呆。
   */
  const handleAuthFailure = useCallback(
    (err: unknown): boolean => {
      if (err instanceof ApiError && (err.isAuthFailure || err.code === 'account_disabled')) {
        forgetIdentity()
        setStatus('anonymous')
        setNotice(err.code === 'account_disabled' ? '账号已被停用，请联系管理员' : '登录已过期，请重新登录')
        return true
      }
      return false
    },
    [forgetIdentity]
  )

  const login = useCallback(
    async (email: string, password: string) => {
      setSubmitting(true)
      setError(null)
      setNotice(null)
      try {
        applyIdentity(await api.login(email.trim(), password))
        setStatus('authenticated')
        return true
      } catch (err) {
        setError(describeError(err))
        return false
      } finally {
        setSubmitting(false)
      }
    },
    [applyIdentity]
  )

  const register = useCallback(
    async (email: string, password: string) => {
      setSubmitting(true)
      setError(null)
      setNotice(null)
      try {
        applyIdentity(await api.register(email.trim(), password))
        setStatus('authenticated')
        return true
      } catch (err) {
        setError(describeError(err))
        return false
      } finally {
        setSubmitting(false)
      }
    },
    [applyIdentity]
  )

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      // 退出接口失败也要把本地状态清掉，否则界面会卡在「已登录」但什么都干不了
    }
    forgetIdentity()
    setStatus('anonymous')
    setNotice(null)
    setError(null)
  }, [forgetIdentity])

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

  /**
   * 重新问一次后端「我是谁」。
   * 用在"身份或站点设置可能在别处变了"的场合 —— 例如站长刚在后台开启了留言功能，
   * 或者刚把自己的账号加/移出管理员白名单。
   */
  const refreshIdentity = useCallback(async () => {
    try {
      applyIdentity(await api.me())
    } catch {
      // 刷新失败不改动现状：真失效了，别的请求会触发 handleAuthFailure
    }
  }, [applyIdentity])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      isAdmin,
      feedbackEnabled,
      error,
      notice,
      submitting,
      login,
      register,
      logout,
      changePassword,
      clearError,
      handleAuthFailure,
      refreshIdentity,
      userKey: userKeyOf(user),
    }),
    [
      user,
      status,
      isAdmin,
      feedbackEnabled,
      error,
      notice,
      submitting,
      login,
      register,
      logout,
      changePassword,
      clearError,
      handleAuthFailure,
      refreshIdentity,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
