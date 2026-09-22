import { createContext, useContext } from 'react'
import type { PublicUser } from '../api/client'

/** checking = 正在问后端「我是谁」（Cookie 里可能已有有效会话） */
export type AuthStatus = 'checking' | 'anonymous' | 'authenticated'

export interface AuthContextValue {
  user: PublicUser | null
  status: AuthStatus
  /** 登录/注册/改密码失败的提示文案 */
  error: string | null
  /** 会话失效的提示（显示在登录页顶部，登录成功即清除） */
  notice: string | null
  submitting: boolean
  login(email: string, password: string): Promise<boolean>
  register(email: string, password: string): Promise<boolean>
  logout(): Promise<void>
  changePassword(currentPassword: string, newPassword: string): Promise<void>
  clearError(): void
  /**
   * 数据层遇到 401 / session_expired 时调用：统一踢回登录页。
   * 返回 true 表示确实处理了（调用方不必再弹「保存失败」）。
   */
  handleAuthFailure(err: unknown): boolean
  /** 本地缓存用的键（u<用户ID>）；未登录时为 null */
  userKey: string | null
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内部使用')
  return ctx
}

/** 把用户 ID 映射成缓存库后缀，实现「一个账号一份缓存」 */
export function userKeyOf(user: PublicUser | null): string | null {
  return user ? `u${user.id}` : null
}
