import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { adminApi } from '../../api/client'
import { DANGER_BTN, EmptyState, ErrorNote, Loading, OkNote, Panel, formatTime, useAsync, useFlash } from './ui'

const SMALL_BTN =
  'rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-t2 transition hover:bg-fill disabled:opacity-50'

/**
 * 注册邀请码。
 * 配合「设置 → 需要邀请码」使用：开启后注册必须填码。
 * 核销是带乐观锁的单事务操作，两个人抢最后一个名额时只有一个能过。
 */
export default function InvitesPanel() {
  const { data, loading, error, reload } = useAsync(() => adminApi.invites(), [])
  const [code, setCode] = useState('')
  const [maxUses, setMaxUses] = useState('1')
  const [expiresAt, setExpiresAt] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const { flash, show } = useFlash()

  async function create() {
    setBusy(true)
    try {
      const result = await adminApi.createInvite({
        code: code.trim() || undefined,
        maxUses: Number(maxUses) || 1,
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : undefined,
        note: note.trim() || undefined,
      })
      show('ok', `已生成邀请码 ${result.item.code}`)
      setCode('')
      setNote('')
      setExpiresAt('')
      setMaxUses('1')
      reload()
    } catch (err) {
      show('error', err instanceof Error ? err.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }

  async function remove(target: string) {
    try {
      await adminApi.deleteInvite(target)
      show('ok', `已删除 ${target}`)
      setPendingDelete(null)
      reload()
    } catch (err) {
      show('error', err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <div className="space-y-4">
      {flash && (flash.type === 'ok' ? <OkNote>{flash.text}</OkNote> : <ErrorNote>{flash.text}</ErrorNote>)}

      <Panel title="新建邀请码" description="不填自定义码就自动生成一个 8 位易读码。">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="field-input"
            placeholder="自定义码（可留空）"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <input
            className="field-input"
            placeholder="可用次数"
            inputMode="numeric"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ''))}
          />
          <input className="field-input" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} title="到期日（可留空）" />
          <input className="field-input" placeholder="备注（给谁用）" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button type="button" className="btn-primary mt-3" disabled={busy} onClick={() => void create()}>
          {busy ? '生成中…' : '生成邀请码'}
        </button>
      </Panel>

      <Panel
        title="已生成的邀请码"
        description="用完或过期的码仍然会列出，方便你核对谁是用哪个码进来的。"
        actions={
          <button type="button" className={SMALL_BTN} onClick={reload} disabled={loading}>
            <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden="true" />
            刷新
          </button>
        }
      >
        {loading && <Loading />}
        {error && !loading && <ErrorNote>加载失败：{error}</ErrorNote>}
        {data &&
          (data.items.length === 0 ? (
            <EmptyState>还没有邀请码</EmptyState>
          ) : (
            <ul className="space-y-2">
              {data.items.map((item) => {
                const expired = item.expiresAt != null && item.expiresAt < new Date().toISOString()
                const usedUp = item.usedCount >= item.maxUses
                return (
                  <li key={item.code} className="rounded-lg border border-line bg-fill/30 px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <code className="select-all rounded bg-surface px-2 py-0.5 font-mono text-xs text-t1">{item.code}</code>
                        {expired && (
                          <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-t5">已过期</span>
                        )}
                        {!expired && usedUp && (
                          <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-t5">已用完</span>
                        )}
                        {!expired && !usedUp && (
                          <span className="rounded-full border border-accent-emerald/40 px-1.5 py-0.5 text-[10px] text-accent-emerald-text">
                            可用
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-3 text-[11px] text-t4">
                        <span>
                          {item.usedCount} / {item.maxUses} 次
                        </span>
                        {item.expiresAt && <span>至 {formatTime(item.expiresAt)}</span>}
                        {pendingDelete === item.code ? (
                          <>
                            <button type="button" className={DANGER_BTN} onClick={() => void remove(item.code)}>
                              确认删除
                            </button>
                            <button type="button" className="underline" onClick={() => setPendingDelete(null)}>
                              取消
                            </button>
                          </>
                        ) : (
                          <button type="button" className={DANGER_BTN} onClick={() => setPendingDelete(item.code)}>
                            删除
                          </button>
                        )}
                      </span>
                    </div>
                    {item.note && <p className="mt-1 text-[11px] text-t4">备注：{item.note}</p>}
                    {item.uses.length > 0 && (
                      <ul className="mt-2 space-y-0.5 border-t border-line-soft pt-2 text-[11px] text-t5">
                        {item.uses.map((use) => (
                          <li key={`${use.userId}-${use.usedAt}`}>
                            {use.email} · {formatTime(use.usedAt)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          ))}
      </Panel>
    </div>
  )
}
