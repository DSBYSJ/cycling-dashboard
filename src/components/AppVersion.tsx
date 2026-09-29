/**
 * 页脚的应用版本号（形如 `v1.0.0`）。
 *
 * 值来自 `src/version.ts`，最终源头是 package.json 的 version —— 构建时注入，
 * 所以页面上显示的一定就是当时打出来的那份代码的版本，不会与实际不一致。
 *
 * 放在页脚而不是设置页：它是「这是哪个版本」的元信息，出问题时用户顺手就能念出来。
 *
 * 站长在后台关掉「更新日志」开关时，版本号仍是纯文本、不可点击；
 * 开启时才渲染成按钮，点了弹 `ChangelogDialog`。
 */

import { useState } from 'react'
import { APP_VERSION } from '../version'
import { useChangelogEnabled } from '../hooks/useChangelogEnabled'
import ChangelogDialog from './ChangelogDialog'

export function AppVersion() {
  const changelogEnabled = useChangelogEnabled()
  const [open, setOpen] = useState(false)

  if (!changelogEnabled) {
    return <span title="应用版本号">v{APP_VERSION}</span>
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="查看更新内容"
        className="transition hover:text-t2"
      >
        v{APP_VERSION}
      </button>
      {open && <ChangelogDialog onClose={() => setOpen(false)} />}
    </>
  )
}
