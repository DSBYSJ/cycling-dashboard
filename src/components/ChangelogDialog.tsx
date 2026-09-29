import { X } from 'lucide-react'
import { CHANGELOG } from '../data/changelog'
import { APP_VERSION } from '../version'

/**
 * 更新日志弹窗：点击页脚版本号后弹出，按版本倒序列出每个版本做了什么。
 *
 * 内容是纯前端静态数据（`data/changelog.ts`），不依赖后端 ——
 * 所以它和「是否显示入口」的开关是解耦的：开关只控制按钮显隐，不影响数据本身。
 */
export default function ChangelogDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-t1">更新日志</h2>
            <p className="mt-0.5 text-[11px] text-t4">当前版本 v{APP_VERSION}</p>
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

        <div className="overflow-y-auto px-4 py-3">
          {CHANGELOG.map((entry) => (
            <div key={entry.version} className="border-b border-line-soft py-3 first:pt-0 last:border-0 last:pb-0">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-t1">v{entry.version}</span>
                <span className="text-[11px] text-t5">{entry.date}</span>
              </div>

              {entry.groups.map((group) => (
                <div key={group.title} className="mt-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-t4">{group.title}</p>
                  <ul className="mt-1 space-y-1">
                    {group.items.map((item) => (
                      <li key={item} className="flex gap-2 text-xs leading-5 text-t3">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent-sky" aria-hidden="true" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
