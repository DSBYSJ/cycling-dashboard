import { adminApi } from '../../api/client'
import {
  ACTION_LABEL,
  EmptyState,
  ErrorNote,
  Loading,
  Panel,
  StatCard,
  formatSize,
  formatTime,
  formatUptime,
  useAsync,
} from './ui'

/** 概览：一眼看清站点规模、服务状态与最近发生了什么 */
export default function OverviewPanel() {
  const { data, loading, error, reload } = useAsync(() => adminApi.overview(), [])

  if (loading) return <Loading />
  if (error) {
    return (
      <ErrorNote>
        加载失败：{error}
        <button type="button" className="ml-2 underline" onClick={reload}>
          重试
        </button>
      </ErrorNote>
    )
  }
  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="账号"
          value={data.users.total}
          hint={`停用 ${data.users.disabled} · 近 7 天新增 ${data.users.registeredLast7d}`}
        />
        <StatCard label="骑行记录" value={data.rides.total} hint={`近 7 天 +${data.rides.last7d}`} />
        <StatCard label="单车 / 打卡" value={`${data.bikes} / ${data.days}`} hint="单车数与打卡天数记录数" />
        <StatCard label="邀请码" value={data.invites} hint="可凭码注册（关闭注册时不生效）" />
      </div>

      <Panel title="服务状态" description="后端进程与存储占用">
        <dl className="grid gap-x-6 gap-y-2 text-[11px] sm:grid-cols-2">
          <Row label="Node 版本" value={data.server.nodeVersion} />
          <Row label="运行环境" value={`${data.server.platform}${data.server.isProduction ? ' · 生产模式' : ' · 开发模式'}`} />
          <Row label="已运行" value={formatUptime(data.server.uptimeSec)} />
          <Row label="常驻内存" value={`${data.server.rssMb} MB`} />
          <Row label="数据库" value={formatSize(data.storage.dbSizeKb)} />
          <Row label="WAL" value={data.storage.walSizeKb > 0 ? formatSize(data.storage.walSizeKb) : '已合并'} />
          <Row
            label="备份"
            value={`${data.storage.backup.count} 份 · ${formatSize(data.storage.backup.totalKb)}`}
          />
          <Row label="备份保留" value={`${data.storage.backup.keepDays} 天`} />
        </dl>
      </Panel>

      <Panel title="当前开关" description="这些项可以在「设置」里直接改，不必改服务器配置或重启">
        <div className="flex flex-wrap gap-2">
          {data.settings.map((item) => (
            <span
              key={item.key}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${
                item.value
                  ? 'border-accent-emerald/40 text-accent-emerald-text'
                  : 'border-line bg-fill text-t4'
              }`}
            >
              {SETTING_LABEL[item.key] ?? item.key}：{item.value ? '开' : '关'}
              {item.overridden ? '（后台已改）' : '（服务器配置）'}
            </span>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="最近注册">
          {data.recentUsers.length === 0 ? (
            <EmptyState>还没有账号</EmptyState>
          ) : (
            <ul className="space-y-2">
              {data.recentUsers.map((user) => (
                <li key={user.id} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="min-w-0 truncate text-t2">{user.email}</span>
                  <span className="shrink-0 text-t5">{formatTime(user.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="最近管理操作">
          {data.recentAudit.length === 0 ? (
            <EmptyState>还没有管理操作记录</EmptyState>
          ) : (
            <ul className="space-y-2">
              {data.recentAudit.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="min-w-0 truncate text-t2">
                    {ACTION_LABEL[entry.action] ?? entry.action}
                    {entry.target ? <span className="text-t5"> · {entry.target}</span> : null}
                  </span>
                  <span className="shrink-0 text-t5">{formatTime(entry.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-soft pb-1.5">
      <dt className="text-t4">{label}</dt>
      <dd className="text-t2">{value}</dd>
    </div>
  )
}

const SETTING_LABEL: Record<string, string> = {
  allow_register: '开放注册',
  invite_required: '需要邀请码',
}
