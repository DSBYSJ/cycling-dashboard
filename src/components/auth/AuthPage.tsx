import { useCallback, useState, type FormEvent } from 'react'
import { Eye, EyeOff, Moon, ShieldCheck, Sun } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { HAS_FILING, FilingRecords } from '../FilingRecords'

/**
 * 登录 / 注册页。
 *
 * 校验规则与后端保持一致（`server/src/lib/validate.ts` 才是真正的边界，
 * 这里只是为了让用户不用等一次往返才知道格式不对）。
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PASSWORD_MIN = 8
const PASSWORD_MAX = 200

type Mode = 'login' | 'register'

const BANNER_ERROR =
  'mt-4 rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs leading-5 text-accent-red-text'
const BANNER_NOTICE =
  'mt-4 rounded-lg border border-accent-amber/30 bg-accent-amber/10 px-3 py-2 text-xs leading-5 text-accent-amber-text'

export default function AuthPage() {
  const { login, register, error, notice, submitting, clearError } = useAuth()
  const { theme, toggle: toggleTheme } = useTheme()

  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const switchMode = useCallback(
    (next: Mode) => {
      setMode(next)
      setLocalError(null)
      setConfirm('')
      clearError()
    },
    [clearError]
  )

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const trimmed = email.trim()

      if (!EMAIL_RE.test(trimmed.toLowerCase())) {
        setLocalError('请输入有效的邮箱地址')
        return
      }
      if (password.length < PASSWORD_MIN) {
        setLocalError(`密码至少 ${PASSWORD_MIN} 位`)
        return
      }
      if (password.length > PASSWORD_MAX) {
        setLocalError(`密码最长 ${PASSWORD_MAX} 位`)
        return
      }
      if (mode === 'register' && password !== confirm) {
        setLocalError('两次输入的密码不一致')
        return
      }

      setLocalError(null)
      if (mode === 'login') await login(trimmed, password)
      else await register(trimmed, password)
    },
    [mode, email, password, confirm, login, register]
  )

  const shownError = localError ?? error

  return (
    <div className="relative flex min-h-full items-center justify-center bg-page px-4 py-10">
      <button
        type="button"
        onClick={toggleTheme}
        title={theme === 'dark' ? '切换到日间（浅色）模式' : '切换到夜间（深色）模式'}
        aria-label={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
        className="absolute right-4 top-4 flex items-center gap-1 rounded-full border border-line bg-fill px-2.5 py-1 text-[11px] text-t2 transition hover:bg-fill-strong"
      >
        {theme === 'dark' ? (
          <Sun className="h-3.5 w-3.5 text-accent-amber" aria-hidden="true" />
        ) : (
          <Moon className="h-3.5 w-3.5 text-accent-sky" aria-hidden="true" />
        )}
        {theme === 'dark' ? '日间' : '夜间'}
      </button>

      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="text-3xl" aria-hidden="true">
            🚴
          </span>
          <h1 className="mt-2 text-lg font-bold tracking-wide text-t1">骑行评分监测看板</h1>
          <p className="mt-1 text-xs leading-5 text-t4">登录后骑行数据存在你自己的服务器上，换设备也能看到</p>
        </div>

        <div className="card p-5">
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-line bg-fill p-1" role="tablist">
            {(
              [
                ['login', '登录'],
                ['register', '注册'],
              ] as const
            ).map(([value, label]) => {
              const active = mode === value
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => switchMode(value)}
                  className={`rounded-md px-3 py-1.5 text-sm transition ${
                    active ? 'bg-surface font-medium text-t1 shadow-sm' : 'text-t3 hover:text-t1'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>

          {notice && (
            <div className={BANNER_NOTICE} role="status">
              {notice}
            </div>
          )}
          {shownError && (
            <div className={BANNER_ERROR} role="alert">
              {shownError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
            <div>
              <label className="field-label" htmlFor="auth-email">
                邮箱
              </label>
              <input
                id="auth-email"
                className="field-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                aria-invalid={Boolean(shownError)}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="auth-password">
                密码
              </label>
              <div className="relative">
                <input
                  id="auth-password"
                  className="field-input pr-10"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? `至少 ${PASSWORD_MIN} 位` : ''}
                  aria-invalid={Boolean(shownError)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  title={showPassword ? '隐藏密码' : '显示密码'}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-t4 transition hover:text-t2"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div>
                <label className="field-label" htmlFor="auth-confirm">
                  确认密码
                </label>
                <input
                  id="auth-confirm"
                  className="field-input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  aria-invalid={Boolean(shownError)}
                />
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}
            </button>
          </form>

          <p className="mt-4 text-center text-[11px] leading-5 text-t4">
            {mode === 'login' ? (
              <>
                还没有账号？点上面的<b className="font-medium text-t3">注册</b>，填邮箱和密码就行
              </>
            ) : (
              '注册后会自动登录，并把你之前存在这台浏览器里的记录上传到云端'
            )}
          </p>
        </div>

        <p className="mt-4 flex items-start justify-center gap-1.5 text-[11px] leading-5 text-t5">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            密码用 scrypt 加盐哈希，不存明文；
            <br />
            登录态存在 httpOnly Cookie 里，网页脚本读不到
          </span>
        </p>

        {/* 备案信息来自环境变量；未配置时整块不渲染 */}
        {HAS_FILING && (
          <p className="mt-3 text-center text-[11px] text-t5">
            <FilingRecords />
          </p>
        )}
      </div>
    </div>
  )
}
