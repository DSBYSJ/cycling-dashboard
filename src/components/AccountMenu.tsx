import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { KeyRound, LogOut, ShieldCheck, User } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

/** 与后端 auth/password.ts 的 PASSWORD_MIN_LENGTH 保持一致 */
const PASSWORD_MIN = 6
const PASSWORD_MAX = 200

const MSG_OK = 'mt-3 rounded-lg border border-accent-emerald/30 bg-accent-emerald/10 px-3 py-2 text-[11px] leading-5 text-accent-emerald-text'
const MSG_ERR = 'mt-3 rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-[11px] leading-5 text-accent-red-text'

/**
 * 顶栏的账号入口：显示当前账号、站长控制台入口、改密码、退出登录。
 * 抽成独立组件，避免这些状态和 App 的业务状态混在一起。
 */
export default function AccountMenu({ onOpenAdmin }: { onOpenAdmin?: () => void }) {
  const { user, isAdmin, logout, changePassword, submitting, refreshIdentity } = useAuth()
  const [open, setOpen] = useState(false)
  const [changing, setChanging] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    setChanging(false)
    setCurrent('')
    setNext('')
    setConfirm('')
    setMessage(null)
  }, [])

  // 点空白处 / 按 Esc 关闭
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  // 打开菜单时刷新一次身份：站长可能在后台改过设置（比如刚开了留言功能），
  // 或者刚把某个账号加/移出管理员白名单
  useEffect(() => {
    if (open) void refreshIdentity()
  }, [open, refreshIdentity])

  const handleChangePassword = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (next.length < PASSWORD_MIN) {
        setMessage({ type: 'error', text: `新密码至少 ${PASSWORD_MIN} 位` })
        return
      }
      if (next.length > PASSWORD_MAX) {
        setMessage({ type: 'error', text: `新密码最长 ${PASSWORD_MAX} 位` })
        return
      }
      if (next !== confirm) {
        setMessage({ type: 'error', text: '两次输入的新密码不一致' })
        return
      }
      try {
        await changePassword(current, next)
        setCurrent('')
        setNext('')
        setConfirm('')
        setChanging(false)
        // 后端会给当前设备重新签发令牌，所以这里说明一下，避免用户以为要重新登录
        setMessage({ type: 'ok', text: '密码已修改。当前登录仍然有效，其它设备需重新登录。' })
      } catch (err) {
        setMessage({ type: 'error', text: err instanceof Error ? err.message : '修改失败，请重试' })
      }
    },
    [current, next, confirm, changePassword]
  )

  if (!user) return null

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user.email}
        className="flex max-w-[10rem] items-center gap-1 rounded-full border border-line bg-fill px-2.5 py-1 text-t2 transition hover:bg-fill-strong"
      >
        {isAdmin ? (
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent-sky-text" aria-hidden="true" />
        ) : (
          <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className="truncate">{user.email}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-line bg-surface p-3 shadow-lg"
        >
          <div className="flex items-start gap-2 border-b border-line pb-3">
            <User className="mt-0.5 h-4 w-4 shrink-0 text-t4" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-t1">{user.email}</p>
              <p className="mt-0.5 text-[11px] text-t5">
                {isAdmin ? '管理员账号 · 数据已同步到你的服务器' : '数据已同步到你的服务器'}
              </p>
            </div>
          </div>

          {!changing ? (
            <div className="mt-3 space-y-1">
              {/* 仅管理员可见。真正的权限在后端判 —— 这里只是不给普通用户显示一个用不了的入口 */}
              {isAdmin && onOpenAdmin && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close()
                    onOpenAdmin()
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-accent-sky-text transition hover:bg-fill"
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  站长控制台
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setChanging(true)
                  setMessage(null)
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-t2 transition hover:bg-fill"
              >
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                修改密码
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void logout()}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-accent-red-text transition hover:bg-fill"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                退出登录
              </button>
            </div>
          ) : (
            <form onSubmit={handleChangePassword} className="mt-3 space-y-3">
              <div>
                <label className="field-label" htmlFor="pwd-current">
                  当前密码
                </label>
                <input
                  id="pwd-current"
                  className="field-input"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="pwd-next">
                  新密码
                </label>
                <input
                  id="pwd-next"
                  className="field-input"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder={`至少 ${PASSWORD_MIN} 位`}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="pwd-confirm">
                  确认新密码
                </label>
                <input
                  id="pwd-confirm"
                  className="field-input"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary flex-1" disabled={submitting}>
                  {submitting ? '提交中…' : '确认修改'}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setChanging(false)}>
                  取消
                </button>
              </div>
            </form>
          )}

          {message && <div className={message.type === 'ok' ? MSG_OK : MSG_ERR}>{message.text}</div>}
        </div>
      )}
    </div>
  )
}
