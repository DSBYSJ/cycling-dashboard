import { useState } from 'react'
import {
  BarChart3,
  Database as DatabaseIcon,
  FileText,
  HardDrive,
  Settings as SettingsIcon,
  Terminal,
  Ticket,
  Users as UsersIcon,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import OverviewPanel from './OverviewPanel'
import UsersPanel from './UsersPanel'
import DataPanel from './DataPanel'
import BackupsPanel from './BackupsPanel'
import AuditPanel from './AuditPanel'
import SettingsPanel from './SettingsPanel'
import InvitesPanel from './InvitesPanel'
import SystemPanel from './SystemPanel'

type Section = 'overview' | 'users' | 'data' | 'backups' | 'audit' | 'invites' | 'settings' | 'system'

const SECTIONS: { id: Section; label: string; icon: typeof UsersIcon }[] = [
  { id: 'overview', label: '概览', icon: BarChart3 },
  { id: 'users', label: '账号', icon: UsersIcon },
  { id: 'data', label: '数据', icon: DatabaseIcon },
  { id: 'backups', label: '备份', icon: HardDrive },
  { id: 'audit', label: '审计', icon: FileText },
  { id: 'invites', label: '邀请码', icon: Ticket },
  { id: 'settings', label: '设置', icon: SettingsIcon },
  { id: 'system', label: '日志', icon: Terminal },
]

/**
 * 站长控制台。
 *
 * 这一屏**只对管理员显示**，但真正的权限在后端 ——
 * 每个 /api/admin/* 接口都会独立校验，普通账号即使手动打开 #/admin 也只会看到 403。
 */
export default function AdminTab() {
  const { user } = useAuth()
  const [section, setSection] = useState<Section>('overview')

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold text-t1">站长控制台</h1>
            <p className="mt-1 text-[11px] leading-5 text-t4">
              当前登录：{user?.email ?? '—'} · 这里的每一步操作都会记入审计日志
            </p>
          </div>
        </div>

        <nav className="mt-3 flex flex-wrap gap-1.5">
          {SECTIONS.map((item) => {
            const Icon = item.icon
            const active = section === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition ${
                  active
                    ? 'border-accent-sky/50 bg-accent-sky/10 text-accent-sky-text'
                    : 'border-line text-t3 hover:bg-fill'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {item.label}
              </button>
            )
          })}
        </nav>
      </div>

      {section === 'overview' && <OverviewPanel />}
      {section === 'users' && <UsersPanel />}
      {section === 'data' && <DataPanel />}
      {section === 'backups' && <BackupsPanel />}
      {section === 'audit' && <AuditPanel />}
      {section === 'invites' && <InvitesPanel />}
      {section === 'settings' && <SettingsPanel />}
      {section === 'system' && <SystemPanel />}
    </div>
  )
}
