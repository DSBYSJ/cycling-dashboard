import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Eye, EyeOff, Moon, ShieldCheck, Sun } from 'lucide-react'
import { api } from '../../api/client'
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
/** 纯用户名（不含 @）：字母/数字开头，只含字母数字下划线连字符，3–30 位 —— 与后端一致 */
const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/
/** 密码下限 6 位：与后端 `auth/password.ts` 的 PASSWORD_MIN_LENGTH 保持一致 */
const PASSWORD_MIN = 6
const PASSWORD_MAX = 200

/** 账号标识同时接受邮箱与纯用户名 */
function isValidAccount(v: string): boolean {
  return EMAIL_RE.test(v) || USERNAME_RE.test(v)
}

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

  /**
   * 注册开关：`null` = 还没问到，此时按「开放」显示。
   * 只有确定拿到 false 才改成「暂停注册」—— 问不到（离线、后端抽风）时宁可少报，
   * 不要谎称暂停。真正拦人的是后端 `/register`，这里只负责界面别说错。
   */
  const [registerOpen, setRegisterOpen] = useState<boolean | null>(null)
  /** 点了「暂停注册」时的说明；与「会话失效」的 notice 分开，避免互相覆盖 */
  const [pausedHint, setPausedHint] = useState<string | null>(null)

  const registerPaused = registerOpen === false

  useEffect(() => {
    let alive = true
    api
      .authConfig()
      .then((cfg) => {
        if (alive) setRegisterOpen(cfg.allowRegister)
      })
      .catch(() => {
        /* 问不到就维持「开放」的显示，能不能注册最终由后端说了算 */
      })
    return () => {
      alive = false
    }
  }, [])

  // 万一用户先点了「注册」、随后才拿到「已暂停」，把他送回登录表单并说明原因
  useEffect(() => {
    if (registerPaused && mode === 'register') {
      setMode('login')
      setPausedHint('本站已暂停注册，如需账号请联系站长')
    }
  }, [registerPaused, mode])

  const switchMode = useCallback(
    (next: Mode) => {
      // 注册已暂停：不切表单，给一句说明
      if (next === 'register' && registerPaused) {
        setPausedHint('本站已暂停注册，如需账号请联系站长')
        return
      }
      setMode(next)
      setLocalError(null)
      setPausedHint(null)
      setConfirm('')
      clearError()
    },
    [clearError, registerPaused]
  )

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const trimmed = email.trim()

      if (!isValidAccount(trimmed.toLowerCase())) {
        setLocalError('请输入邮箱，或 3–30 位的用户名（字母、数字、下划线、连字符）')
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
                ['register', registerPaused ? '暂停注册' : '注册'],
              ] as const
            ).map(([value, label]) => {
              const active = mode === value
              const paused = registerPaused && value === 'register'
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => switchMode(value)}
                  className={`rounded-md px-3 py-1.5 text-sm transition ${
                    paused
                      ? 'cursor-not-allowed text-t5'
                      : active
                        ? 'bg-surface font-medium text-t1 shadow-sm'
                        : 'text-t3 hover:text-t1'
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
          {pausedHint && (
            <div className={BANNER_NOTICE} role="status">
              {pausedHint}
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
                账号
              </label>
              <input
                id="auth-email"
                className="field-input"
                /* 用 text 而不是 email：后端已支持纯用户名，email 类型会被浏览器原生校验拦下 */
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com 或用户名"
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
            {registerPaused ? (
              '本站已暂停注册，如需账号请联系站长'
            ) : mode === 'login' ? (
              <>
                还没有账号？点上面的<b className="font-medium text-t3">注册</b>，填账号和密码就行
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

        {/* 公开页入口：没有账号的人也能看到这个项目做了什么、用了什么技术 */}
        <p className="mt-4 text-center text-[11px] text-t5">
          <a href="#/about" className="transition hover:text-t2">
            了解本站 · 功能与技术
          </a>
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
