/**
 * 网站底部 ICP 备案号展示。
 *
 * 备案号从环境变量 `VITE_ICP_LICENSE` 读取（配置在 `.env`，已被 .gitignore 覆盖），
 * **不写进源码** —— 免得备案信息随公开仓库一起传播。构建时由 Vite 内联进产物，
 * 所以线上照常显示；本地未配置时整块不渲染，不会留下空链接或多余的间隔符。
 *
 * 工信部要求：已备案网站须在首页底部展示备案号，并链接到工信部备案管理系统
 * （https://beian.miit.gov.cn/）。
 */

/** 备案号；未配置时为空串，调用方可用它决定是否渲染分隔符等附属元素 */
export const ICP_LICENSE = (import.meta.env.VITE_ICP_LICENSE ?? '').trim()

export function IcpRecord() {
  if (!ICP_LICENSE) return null

  return (
    <a
      className="transition hover:text-t2"
      href="https://beian.miit.gov.cn/"
      target="_blank"
      rel="noopener noreferrer"
    >
      {ICP_LICENSE}
    </a>
  )
}
