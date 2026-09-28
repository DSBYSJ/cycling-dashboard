import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { adminApi } from '../../api/client'
import { ACTION_LABEL, EmptyState, ErrorNote, Loading, OkNote, Panel, formatTime, useAsync, useFlash } from './ui'

const PAGE_SIZE = 50

const SMALL_BTN =
  'rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-t2 transition hover:bg-fill disabled:opacity-50'

const FILTERS = [
  { id: '', label: '全部操作' },
  { id: 'user.', label: '账号相关' },
  { id: 'setting.', label: '系统设置' },
  { id: 'ride.', label: '记录相关' },
  { id: 'backup.', label: '备份相关' },
  { id: 'feedback.', label: '留言相关' },
  { id: 'invite.', label: '邀请码' },
  { id: 'audit.', label: '日志维护' },
]

/** 审计日志：出问题时唯一的举证材料 */
export default function AuditPanel() {
  const [action, setAction] = useState('')
  const [page, setPage] = useState(0)
  const { data, loading, error, reload } = useAsync(
    () => adminApi.audit({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, action }),
    [action, page]
  )
  const { flash, show } = useFlash()

  async function prune() {
    try {
      const result = await adminApi.pruneAudit()
      show('ok', `已清理 ${result.removed} 条旧记录（保留最近 5000 条）`)
      reload()
    } catch (err) {
      show('error', err instanceof Error ? err.message : '清理失败')
    }
  }

  const total = data?.total ?? 0
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)

  return (
    <div className="space-y-4">
      {flash && (flash.type === 'ok' ? <OkNote>{flash.text}</OkNote> : <ErrorNote>{flash.text}</ErrorNote>)}

      <Panel
        title="管理操作日志"
        description="所有写操作都会记一条，记的是「发生了什么」，不含密码等敏感内容。"
        actions={
          <div className="flex gap-2">
            <button type="button" className={SMALL_BTN} onClick={reload} disabled={loading}>
              <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden="true" />
              刷新
            </button>
            <button type="button" className={SMALL_BTN} onClick={() => void prune()}>
              清理旧记录
            </button>
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.id || 'all'}
              type="button"
              onClick={() => {
                setAction(item.id)
                setPage(0)
              }}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                action === item.id ? 'border-accent-sky/50 bg-accent-sky/10 text-accent-sky-text' : 'border-line text-t4 hover:bg-fill'
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
              <EmptyState>没有记录</EmptyState>
            ) : (
              <ul className="space-y-1.5">
                {data.items.map((entry) => (
                  <li key={entry.id} className="rounded-lg border border-line bg-fill/30 px-3 py-2 text-[11px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-t1">{ACTION_LABEL[entry.action] ?? entry.action}</span>
                      <span className="text-t5">{formatTime(entry.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-t4">
                      操作者 #{entry.actorId}
                      {entry.target ? ` · 对象 ${entry.target}` : ''}
                      {entry.ip ? ` · IP ${entry.ip}` : ''}
                    </p>
                    {entry.detail && <p className="mt-0.5 break-all font-mono text-[10px] text-t5">{entry.detail}</p>}
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
