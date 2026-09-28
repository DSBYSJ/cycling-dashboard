import { useState } from 'react'
import { Database as DatabaseIcon, RefreshCw } from 'lucide-react'
import { adminApi } from '../../api/client'
import {
  DANGER_BTN,
  EmptyState,
  ErrorNote,
  Loading,
  OkNote,
  Panel,
  formatSize,
  formatTime,
  useAsync,
  useFlash,
} from './ui'

const SMALL_BTN =
  'rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-t2 transition hover:bg-fill disabled:opacity-50'

/**
 * 备份与数据库状态。
 *
 * 只做「创建 / 列出 / 删除」，**刻意不做"下载备份"** ——
 * 备份文件就是整个数据库（含所有账号的密码哈希），
 * 需要取走时走宝塔文件管理器或 SSH，多一道人工确认更安全。
 */
export default function BackupsPanel() {
  const backups = useAsync(() => adminApi.backups(), [])
  const dbStatus = useAsync(() => adminApi.dbStatus(), [])
  const [busy, setBusy] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const { flash, show } = useFlash()

  async function createBackup() {
    setBusy(true)
    try {
      const result = await adminApi.createBackup()
      show(
        'ok',
        `已创建 ${result.item.name}（${formatSize(result.item.sizeKb)}）` +
          (result.removed > 0 ? `，并清理了 ${result.removed} 份过期备份` : '')
      )
      backups.reload()
    } catch (err) {
      show('error', err instanceof Error ? err.message : '备份失败')
    } finally {
      setBusy(false)
    }
  }

  async function removeBackup(name: string) {
    try {
      await adminApi.deleteBackup(name)
      show('ok', `已删除 ${name}`)
      setPendingDelete(null)
      backups.reload()
    } catch (err) {
      show('error', err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <div className="space-y-4">
      {flash && (flash.type === 'ok' ? <OkNote>{flash.text}</OkNote> : <ErrorNote>{flash.text}</ErrorNote>)}

      <Panel
        title="备份"
        description="用 SQLite 的 VACUUM INTO 做事务一致快照 —— 不用停服务，WAL 里的最新写入也不会漏。"
        actions={
          <div className="flex gap-2">
            <button type="button" className={SMALL_BTN} onClick={backups.reload} disabled={backups.loading}>
              <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden="true" />
              刷新
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void createBackup()}>
              {busy ? '备份中…' : '立即备份'}
            </button>
          </div>
        }
      >
        {backups.loading && <Loading />}
        {backups.error && <ErrorNote>加载失败：{backups.error}</ErrorNote>}
        {backups.data && (
          <>
            <p className="mb-3 text-[11px] leading-5 text-t4">
              目录 <span className="font-mono text-t3">{backups.data.info.dir}</span> · 共 {backups.data.info.count} 份 ·{' '}
              {formatSize(backups.data.info.totalKb)} · 保留 {backups.data.info.keepDays} 天（每天 03:30 还会自动备份一次）
            </p>

            {backups.data.items.length === 0 ? (
              <EmptyState>还没有备份</EmptyState>
            ) : (
              <ul className="space-y-1.5">
                {backups.data.items.map((item) => (
                  <li key={item.name} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-fill/30 px-3 py-2 text-[11px]">
                    <span className="min-w-0 truncate font-mono text-t2">{item.name}</span>
                    <span className="flex shrink-0 items-center gap-3 text-t4">
                      <span>{formatSize(item.sizeKb)}</span>
                      <span>{formatTime(item.createdAt)}</span>
                      {pendingDelete === item.name ? (
                        <>
                          <button type="button" className={DANGER_BTN} onClick={() => void removeBackup(item.name)}>
                            确认删除
                          </button>
                          <button type="button" className="underline" onClick={() => setPendingDelete(null)}>
                            取消
                          </button>
                        </>
                      ) : (
                        <button type="button" className={DANGER_BTN} onClick={() => setPendingDelete(item.name)}>
                          删除
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-3 text-[11px] leading-5 text-t5">
              提示：这里不提供「下载备份」。备份文件等于整个数据库（含所有账号的密码哈希），
              要取走请用宝塔文件管理器或 SSH —— 多一道人工确认更稳妥。
            </p>
          </>
        )}
      </Panel>

      <Panel
        title="数据库自检"
        description="完整性检查与各表行数"
        actions={
          <button type="button" className={SMALL_BTN} onClick={dbStatus.reload} disabled={dbStatus.loading}>
            <DatabaseIcon className="mr-1 inline h-3 w-3" aria-hidden="true" />
            重新检查
          </button>
        }
      >
        {dbStatus.loading && <Loading label="检查中…" />}
        {dbStatus.error && <ErrorNote>检查失败：{dbStatus.error}</ErrorNote>}
        {dbStatus.data && (
          <>
            <p className="mb-3 text-[11px]">
              完整性：
              <span className={dbStatus.data.integrity === 'ok' ? 'text-accent-emerald-text' : 'text-accent-red-text'}>
                {dbStatus.data.integrity}
              </span>
            </p>
            <ul className="grid gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-2">
              {dbStatus.data.tables.map((row) => (
                <li key={row.table} className="flex items-center justify-between gap-3 border-b border-line-soft pb-1">
                  <span className="font-mono text-t3">{row.table}</span>
                  <span className="text-t2">{row.rows} 行</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </div>
  )
}
