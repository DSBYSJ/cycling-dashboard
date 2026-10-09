import { memo } from 'react'

/**
 * 页底氛围层：极光光斑 + 顶部技术网格。
 *
 * 纯装饰，所以整体不进无障碍树（aria-hidden）、不接收指针事件。
 * 固定在视口最底层（CSS 里 z-index:-1，位于页面底色之上、内容之下）。
 * 动画只有 transform/scale，72~96s 的长周期 —— 常驻运行也几乎不占 GPU。
 */
function AuroraBackground() {
  return (
    <div className="aurora-layer" aria-hidden="true">
      <div className="grid-layer" />
      <div className="aurora-blob aurora-blob-1" />
      <div className="aurora-blob aurora-blob-2" />
      <div className="aurora-blob aurora-blob-3" />
    </div>
  )
}

export default memo(AuroraBackground)
