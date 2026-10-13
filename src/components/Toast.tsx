import { useEffect, type CSSProperties } from 'react'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastMessage {
  id: number
  message: string
  type: ToastType
}

interface Props {
  toast: ToastMessage
  onClose: () => void
  /** 自动关闭时间(毫秒) */
  duration?: number
}

const STYLES: Record<ToastType, { box: string; icon: string }> = {
  success: { box: 'border-accent-emerald/30 bg-accent-emerald/15 text-accent-emerald-text', icon: 'text-accent-emerald-text' },
  error: { box: 'border-accent-red/30 bg-accent-red/15 text-accent-red-text', icon: 'text-accent-red-text' },
  info: { box: 'border-accent-sky/30 bg-accent-sky/15 text-accent-sky-text', icon: 'text-accent-sky-text' },
}

/** 轻量 Toast:固定显示在窗口底部居中,自动消失,不引入额外的 UI 组件库 */
export default function Toast({ toast, onClose, duration = 2600 }: Props) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, duration)
    return () => window.clearTimeout(timer)
  }, [toast.id, duration, onClose])

  const style = STYLES[toast.type]
  const Icon = toast.type === 'success' ? CheckCircle2 : toast.type === 'error' ? AlertCircle : Info

  return (
    <div
      className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 px-4"
      // App 里浮在手势区之上（浏览器 env()=0，无变化）
      style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div
        role="status"
        aria-live="polite"
        className={`relative flex animate-toast-in items-center gap-2 overflow-hidden rounded-xl border px-4 py-2.5 pb-3 text-sm shadow-xl shadow-black/40 backdrop-blur ${style.box}`}
      >
        <Icon className={`h-4 w-4 shrink-0 ${style.icon}`} aria-hidden="true" />
        <span className="whitespace-nowrap">{toast.message}</span>
        {/* 剩余时间条：随自动关闭倒计时收短（--toast-ms 与上面的定时器等长） */}
        <span
          className="toast-life"
          style={{ '--toast-ms': `${duration}ms` } as CSSProperties}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
