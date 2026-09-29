/**
 * 页脚的应用版本号（形如 `v1.0.0`）。
 *
 * 值来自 `src/version.ts`，最终源头是 package.json 的 version —— 构建时注入，
 * 所以页面上显示的一定就是当时打出来的那份代码的版本，不会与实际不一致。
 *
 * 放在页脚而不是设置页：它是「这是哪个版本」的元信息，出问题时用户顺手就能念出来。
 */

import { APP_VERSION } from '../version'

export function AppVersion() {
  return <span title="应用版本号">v{APP_VERSION}</span>
}
