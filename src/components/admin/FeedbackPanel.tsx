import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { adminApi } from '../../api/client'
import { EmptyState, ErrorNote, Loading, OkNote, Panel, formatTime, useAsync, useFlash } from './ui'

const PAGE_SIZE = 30

const SMALL_BTN =
  'rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-t2 transition hover:bg-fill disabled:opacity-50'

const FILTERS = [
  { id: '', label: '全部' },
  { id: 'open', label: '未处理' },
  { id: 'done', label: '已处理' },
]

/**
 * 用户留言。
 * 严格单向：用户只看到自己提交的与你的回复，彼此看不到 ——
 * 所以它不构成"用户间信息发布"，合规上只相当于意见反馈。
 */
export default function FeedbackPanel() {
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const { data, loading, error, reload } = useAsync(
    () => adminApi.feedback({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, status }),
    [status, page]
  )
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [busyId, setBusyId] = useState<number | null>(null)
  const { flash, show } = useFlash()

  async function reply(id: number) {
    const text = (drafts[id] ?? '').trim()
    if (!text) return
    setBusyId(id)
    try {
      await adminApi.replyFeedback(id, text)
      show('ok', '已回复')
      setDrafts((prev) => ({ ...prev, [id]: '' }))
      reload()
    } catch (err) {
      show('error', err instanceof Error ? err.message : '回复失败')
    } finally {
      setBusyId(null)
    }
  }

  async function setStatusOf(id: number, next: 'open' | 'done') {
    setBusyId(id)
    try {
      await adminApi.setFeedbackStatus(id, next)
      reload()
    } catch (err) {
      show('error', err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusyId(null)
    }
  }

  const total = data?.total ?? 0
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)

  return (
    <div className="space-y-4">
      {flash && (flash.type === 'ok' ? <OkNote>{flash.text}</OkNote> : <ErrorNote>{flash.text}</ErrorNote>)}

      <Panel
        title="用户留言"
        description="留言默认不对外开放 —— 先在「设置」里开启，用户才会看到入口。"
        actions={
          <button type="button" className={SMALL_BTN} onClick={reload} disabled={loading}>
            <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden="true" />
            刷新
          </button>
        }
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.id || 'all'}
              type="button"
              onClick={() => {
                setStatus(item.id)
                setPage(0)
              }}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                status === item.id ? 'border-accent-sky/50 bg-accent-sky/10 text-accent-sky-text' : 'border-line text-t4 hover:bg-fill'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {loading && <Loading />}
        {error && !loading && <ErrorNote>加载失败：{error}</ErrorNote>}

        {!loading && !error && data && (
          <>
            {data.items.length === 0 ? (
              <EmptyState>还没有留言</EmptyState>
            ) : (
              <ul className="space-y-3">
                {data.items.map((item) => (
                  <li key={item.id} className="rounded-lg border border-line bg-fill/30 px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="min-w-0 truncate text-t2">{item.userEmail}</span>
                      <span className="flex shrink-0 items-center gap-2 text-t5">
                        {item.status === 'open' ? (
                          <span className="rounded-full border border-accent-amber/40 px-1.5 py-0.5 text-[10px] text-accent-amber-text">
                            未处理
                          </span>
                        ) : (
                          <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px]">已处理</span>
                        )}
                        {formatTime(item.createdAt)}
                      </span>
                    </div>

                    <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-t1">{item.content}</p>

                    {item.reply && (
                      <div className="mt-2 rounded-lg border border-line bg-surface px-2.5 py-2">
                        <p className="text-[10px] text-t5">你的回复 · {formatTime(item.repliedAt)}</p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-t2">{item.reply}</p>
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        className="field-input flex-1"
                        placeholder={item.reply ? '再回复一次（会覆盖原回复）' : '写下回复…'}
                        value={drafts[item.id] ?? ''}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void reply(item.id)
                        }}
                      />
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={busyId === item.id || !(drafts[item.id] ?? '').trim()}
                        onClick={() => void reply(item.id)}
                      >
                        回复
                      </button>
                      <button
                        type="button"
                        className={SMALL_BTN}
                        disabled={busyId === item.id}
                        onClick={() => void setStatusOf(item.id, item.status === 'open' ? 'done' : 'open')}
                      >
                        {item.status === 'open' ? '标记已处理' : '重新打开'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {total > PAGE_SIZE && (
              <div className="mt-3 flex items-center justify-between text-[11px] text-t5">
                <span>共 {total} 条</span>
                <div className="flex items-center gap-2">
                  <button type="button" className={SMALL_BTN} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    上一页
                  </button>
                  <span>
                    第 {page + 1} / {maxPage + 1} 页
                  </span>
                  <button type="button" className={SMALL_BTN} disabled={page >= maxPage} onClick={() => setPage((p) => p + 1)}>
                    下一页
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  )
}
