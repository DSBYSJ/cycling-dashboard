import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { ApiError, api, type FeedbackItem } from '../api/client'

/**
 * 「给站长留言」——**单向、不公开**。
 *
 * 用户之间互相看不到对方的留言，也看不到别人的回复，所以它不构成
 * "用户间信息发布"或"即时通讯"，合规上只相当于意见反馈
 * （依据见 docs/用户聊天功能合规评估.md）。
 *
 * 默认关闭：只有站长在后台开启后才对普通用户显示入口；
 * 管理员账号始终可用，方便先把流程自己跑通。
 */
export default function FeedbackBox({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.listFeedback()
      setItems(result.items)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Esc 关闭
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function submit() {
    const text = content.trim()
    if (!text) return
    setBusy(true)
    setError(null)
    try {
      await api.submitFeedback(text)
      setContent('')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-line bg-surface p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
          <div>
            <h2 className="text-sm font-semibold text-t1">给站长留言</h2>
            <p className="mt-1 text-[11px] leading-5 text-t4">
              只有站长能看到你写的内容 —— 其他人看不到，你也看不到别人的。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-lg p-1 text-t4 transition hover:bg-fill hover:text-t2"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3">
          <textarea
            className="field-input min-h-[5rem] resize-y"
            placeholder="想反馈的问题、建议，或者只是打个招呼…"
            maxLength={2000}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[11px] text-t5">{content.length} / 2000</span>
            <button type="button" className="btn-primary" disabled={busy || !content.trim()} onClick={() => void submit()}>
              {busy ? '发送中…' : '发送'}
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-2 rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-[11px] leading-5 text-accent-red-text">
            {error}
          </p>
        )}

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto border-t border-line pt-3">
          <p className="mb-2 text-[11px] text-t5">我发出的留言</p>
          {loading ? (
            <p className="py-4 text-center text-[11px] text-t4">加载中…</p>
          ) : items.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-t5">还没有留言</p>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li key={item.id} className="rounded-lg border border-line bg-fill/30 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-[10px] text-t5">
                    <span>{new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                    <span>{item.status === 'done' ? '已处理' : '待处理'}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-t2">{item.content}</p>
                  {item.reply && (
                    <div className="mt-2 rounded-lg border border-line bg-surface px-2.5 py-2">
                      <p className="text-[10px] text-t5">站长的回复</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-t2">{item.reply}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
