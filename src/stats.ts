/**
 * 项目规模数据（「关于本站」的数据看板）。
 *
 * 值由 `vite.config.ts` **在构建时现场统计**（源码文件数 / 行数、测试用例数、运行时依赖数）
 * 后注入，所以页面上显示的永远是这份代码的真实规模，不会随时间漂移。
 *
 * 兜底：没走 Vite 构建的场景（个别单测、纯类型检查）注入不存在，
 * 此时返回 null，页面会整块不渲染 —— 宁可少一块，也不要显示假数字。
 */
export interface ProjectStats {
  appFiles: number
  appLines: number
  serverFiles: number
  serverLines: number
  testFiles: number
  testCases: number
  frontendDeps: number
  backendDeps: number
}

export const PROJECT_STATS: ProjectStats | null =
  typeof __PROJECT_STATS__ !== 'undefined' ? __PROJECT_STATS__ : null
