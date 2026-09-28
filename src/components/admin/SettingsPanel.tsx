import { useState } from 'react'
import { adminApi, type AdminSetting } from '../../api/client'
import { ErrorNote, Loading, OkNote, Panel, useAsync, useFlash } from './ui'

const LABEL: Record<AdminSetting['key'], { title: string; desc: string }> = {
  allow_register: {
    title: '开放注册',
    desc: '关闭后任何人都无法注册新账号（已登录的用户不受影响）。以前改这一项要登服务器改配置文件并重启，现在点一下就行。',
  },
  feedback_enabled: {
    title: '用户留言',
    desc: '开启后，用户能在账号菜单里给你留言（只有你能看到，用户之间互相看不到）。关闭时管理员仍可测试。',
  },
  invite_required: {
    title: '需要邀请码',
    desc: '开启后注册必须填邀请码。适合只给朋友用的场景 —— 先在这里开启，再到「邀请码」页生成几个码发出去。',
  },
}

const SECRET_NOTE = '出于安全，这里只显示"是否已配置"，不显示任何值。要改就登服务器改 .env。'

/** 系统设置：运行时开关 + 环境变量一览 */
export default function SettingsPanel() {
  const settings = useAsync(() => adminApi.settings(), [])
  const env = useAsync(() => adminApi.env(), [])
  const [busy, setBusy] = useState<string | null>(null)
  const { flash, show } = useFlash()

  async function toggle(item: AdminSetting) {
    setBusy(item.key)
    try {
      await adminApi.updateSetting(item.key, !item.value)
      show('ok', `${LABEL[item.key]?.title ?? item.key} 已${item.value ? '关闭' : '开启'}`)
      settings.reload()
    } catch (err) {
      show('error', err instanceof Error ? err.message : '修改失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {flash && (flash.type === 'ok' ? <OkNote>{flash.text}</OkNote> : <ErrorNote>{flash.text}</ErrorNote>)}

      <Panel title="运行开关" description="改完立即生效，不需要重启服务。">
        {settings.loading && <Loading />}
        {settings.error && <ErrorNote>加载失败：{settings.error}</ErrorNote>}
        {settings.data && (
          <ul className="space-y-3">
            {settings.data.items.map((item) => (
              <li key={item.key} className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft pb-3 last:border-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-t1">
                    {LABEL[item.key]?.title ?? item.key}
                    <span className={`ml-2 rounded-full border px-1.5 py-0.5 text-[10px] ${item.value ? 'border-accent-emerald/40 text-accent-emerald-text' : 'border-line text-t5'}`}>
                      {item.value ? '已开启' : '已关闭'}
                    </span>
                    {!item.overridden && <span className="ml-2 text-[10px] text-t5">（当前值来自服务器 .env）</span>}
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-t4">{LABEL[item.key]?.desc}</p>
                </div>
                <button
                  type="button"
                  className="btn-primary shrink-0"
                  disabled={busy === item.key}
                  onClick={() => void toggle(item)}
                >
                  {busy === item.key ? '处理中…' : item.value ? '关闭' : '开启'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="环境变量" description={SECRET_NOTE}>
        {env.loading && <Loading />}
        {env.error && <ErrorNote>加载失败：{env.error}</ErrorNote>}
        {env.data && (
          <ul className="grid gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-2">
            {env.data.items.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-3 border-b border-line-soft pb-1">
                <span className="min-w-0 truncate font-mono text-t3">{item.key}</span>
                <span className={`shrink-0 ${item.configured ? 'text-accent-emerald-text' : 'text-t5'}`}>
                  {item.configured ? (item.secret ? '已配置（隐藏）' : '已配置') : '未配置'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
