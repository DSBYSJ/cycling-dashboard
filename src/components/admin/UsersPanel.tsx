import { useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { adminApi, type AdminUser } from '../../api/client'
import {
  DANGER_BTN,
  EmptyState,
  ErrorNote,
  Loading,
  OkNote,
  Panel,
  formatTime,
  useAsync,
  useFlash,
} from './ui'

const PAGE_SIZE = 20

const SORTS = [
  { id: 'newest', label: '最新注册' },
  { id: 'oldest', label: '最早注册' },
  { id: 'rides', label: '记录最多' },
  { id: 'active', label: '最近登录' },
] as const

const SMALL_BTN =
  'rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-t2 transition hover:bg-fill disabled:opacity-50'

/** 用户管理：列表、搜索、停用/启用、重置密码、删除 */
export default function UsersPanel() {
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState<string>('newest')
  const [page, setPage] = useState(0)

  const { data, loading, error, reload } = useAsync(
    () => adminApi.users({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, search: keyword, sort }),
    [page, keyword, sort]
  )

  const [busyId, setBusyId] = useState<number | null>(null)
  const { flash, show } = useFlash()
  /** 重置密码的明文只出现一次，所以单独存起来显眼展示，不做成普通提示 */
  const [resetResult, setResetResult] = useState<{ email: string; password: string } | null>(null)
  const [deleting, setDeleting] = useState<AdminUser | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function toggleStatus(user: AdminUser) {
    setBusyId(user.id)
    try {
      await adminApi.setUserStatus(user.id, user.status === 'disabled' ? 'active' : 'disabled')
      show('ok', user.status === 'disabled' ? `已启用 ${user.email}` : `已停用 ${user.email}，对方会立刻被踢下线`)
      reload()
    } catch (err) {
      show('error', err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusyId(null)
    }
  }

  async function resetPassword(user: AdminUser) {
    setBusyId(user.id)
    try {
      const result = await adminApi.resetUserPassword(user.id)
      setResetResult({ email: user.email, password: result.password })
    } catch (err) {
      show('error', err instanceof Error ? err.message : '重置失败')
    } finally {
      setBusyId(null)
    }
  }

  async function doDelete() {
    if (!deleting) return
    setBusyId(deleting.id)
    setDeleteError(null)
    try {
      await adminApi.deleteUser(deleting.id, confirmText)
      show('ok', `已删除 ${deleting.email} 及其全部数据`)
      setDeleting(null)
      setConfirmText('')
      reload()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setBusyId(null)
    }
  }

  const total = data?.total ?? 0
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)

  return (
    <div className="space-y-4">
      {flash && (flash.type === 'ok' ? <OkNote>{flash.text}</OkNote> : <ErrorNote>{flash.text}</ErrorNote>)}

      {resetResult && (
        <OkNote>
          已重置 <b>{resetResult.email}</b> 的密码为{' '}
          <code className="select-all rounded bg-fill px-1.5 py-0.5 font-mono text-xs text-t1">
            {resetResult.password}
          </code>
          <br />
          请立刻转达并保存 —— 这个密码<b>不会再显示</b>；对方的所有旧登录已同时失效。
          <button type="button" className="ml-2 underline" onClick={() => setResetResult(null)}>
            知道了
          </button>
        </OkNote>
      )}

      <Panel
        title="账号列表"
        description="停用会立刻让对方的登录失效；删除会连带清掉他的全部数据。"
        actions={
          <button type="button" className={SMALL_BTN} onClick={reload} disabled={loading}>
            <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden="true" />
            刷新
          </button>
        }
      >
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-t5" aria-hidden="true" />
            <input
              className="field-input pl-8"
              placeholder="搜索账号或昵称，回车确认"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setPage(0)
                  setKeyword(search.trim())
                }
              }}
            />
          </div>
          <select className="field-input w-auto" value={sort} onChange={(e) => { setPage(0); setSort(e.target.value) }}>
            {SORTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setPage(0)
              setKeyword(search.trim())
            }}
          >
            搜索
          </button>
          {keyword && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setSearch('')
                setKeyword('')
                setPage(0)
              }}
            >
              清除
            </button>
          )}
        </div>

        {loading && <Loading />}
        {error && !loading && <ErrorNote>加载失败：{error}</ErrorNote>}

        {!loading && !error && data && (
          <>
            {data.items.length === 0 ? (
              <EmptyState>{keyword ? '没有匹配的账号' : '还没有账号'}</EmptyState>
            ) : (
              <ul className="space-y-2">
                {data.items.map((user) => (
                  <li key={user.id} className="rounded-lg border border-line bg-fill/30 px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-xs text-t1">
                          <span className="truncate">
                            #{user.id} {user.email}
                          </span>
                          {user.status === 'disabled' && (
                            <span className="shrink-0 rounded-full border border-accent-red/40 px-1.5 py-0.5 text-[10px] text-accent-red-text">
                              已停用
                            </span>
                          )}
                        </p>
                        <p className="mt-1 text-[11px] text-t5">
                          注册 {formatTime(user.createdAt)} · 最近登录 {user.lastLoginAt ? formatTime(user.lastLoginAt) : '从未'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-[11px] text-t4">
                        <span>记录 {user.rideCount}</span>
                        <span>单车 {user.bikeCount}</span>
                        <span>打卡 {user.dayCount}</span>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={SMALL_BTN}
                        disabled={busyId === user.id}
                        onClick={() => void toggleStatus(user)}
                      >
                        {user.status === 'disabled' ? '启用' : '停用'}
                      </button>
                      <button
                        type="button"
                        className={SMALL_BTN}
                        disabled={busyId === user.id}
                        onClick={() => void resetPassword(user)}
                      >
                        重置密码
                      </button>
                      <button
                        type="button"
                        className={DANGER_BTN}
                        disabled={busyId === user.id}
                        onClick={() => {
                          setDeleting(user)
                          setConfirmText('')
                          setDeleteError(null)
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {total > PAGE_SIZE && (
              <div className="mt-3 flex items-center justify-between text-[11px] text-t5">
                <span>共 {total} 个账号</span>
                <div className="flex items-center gap-2">
                  <button type="button" className={SMALL_BTN} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    上一页
                  </button>
                  <span>
                    第 {page + 1} / {maxPage + 1} 页
                  </span>
                  <button
                    type="button"
                    className={SMALL_BTN}
                    disabled={page >= maxPage}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>

      {deleting && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-t1">删除账号</h3>
            <p className="mt-2 text-[11px] leading-5 text-t3">
              会连带删除该账号的<b>全部骑行记录、单车与打卡</b>，并且不可恢复。
            </p>
            <p className="mt-3 text-[11px] leading-5 text-t4">
              请输入账号 <b className="select-all text-t2">{deleting.email}</b> 以确认：
            </p>
            <input
              className="field-input mt-2"
              value={confirmText}
              autoFocus
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="完整账号名"
            />
            {deleteError && (
              <div className="mt-2">
                <ErrorNote>{deleteError}</ErrorNote>
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className={DANGER_BTN}
                disabled={busyId === deleting.id || confirmText.trim().toLowerCase() !== deleting.email.toLowerCase()}
                onClick={() => void doDelete()}
              >
                {busyId === deleting.id ? '删除中…' : '确认删除'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setDeleting(null)
                  setConfirmText('')
                  setDeleteError(null)
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
