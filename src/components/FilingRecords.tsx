/**
 * 网站底部的备案信息（ICP 备案 + 公安联网备案）。
 *
 * 两个号码都从环境变量读取（配置在 `.env`，已被 .gitignore 覆盖），
 * **不写进源码** —— 备案信息属于站点运营者的主体信息，没必要随公开仓库传播。
 * 构建时由 Vite 内联进产物，所以线上照常显示；本地未配置则整块不渲染。
 *
 * 官方要求：
 *   · ICP 备案号 → 链接到工信部备案管理系统（https://beian.miit.gov.cn/）
 *   · 公安备案号 → 链接到公安部互联网安全管理服务平台，并把号码里的数字段作为 code 参数
 */

export const ICP_LICENSE = (import.meta.env.VITE_ICP_LICENSE ?? '').trim()
export const PSB_LICENSE = (import.meta.env.VITE_PSB_LICENSE ?? '').trim()

/** 是否至少有一项备案信息；调用方用它决定要不要渲染前置分隔符 */
export const HAS_FILING = Boolean(ICP_LICENSE || PSB_LICENSE)

/**
 * 公安备案的查询链接需要 code 参数，而号码本身就是
 * 「粤公网安备 + 数字段 + 号」，所以直接从号码里取数字段即可 ——
 * 换备案号时只要改环境变量，链接会自动跟着变。
 */
function psbQueryUrl(license: string): string {
  const code = license.match(/\d{6,}/)?.[0]
  return code
    ? `https://beian.mps.gov.cn/#/query/webSearch?code=${code}`
    : 'https://beian.mps.gov.cn/'
}

export function FilingRecords() {
  if (!HAS_FILING) return null

  return (
    <>
      {ICP_LICENSE && (
        <a
          className="transition hover:text-t2"
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noopener noreferrer"
        >
          {ICP_LICENSE}
        </a>
      )}
      {ICP_LICENSE && PSB_LICENSE && <span className="mx-2 text-t5">·</span>}
      {PSB_LICENSE && (
        <a
          className="transition hover:text-t2"
          href={psbQueryUrl(PSB_LICENSE)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {PSB_LICENSE}
        </a>
      )}
    </>
  )
}
