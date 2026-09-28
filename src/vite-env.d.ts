/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * 后端地址。同源部署时留空（前端直接请求 /api/...，由 Nginx 反代）；
   * 本地开发由 vite 代理转发；将来打包成 App 若跨域才需要显式指定。
   */
  readonly VITE_API_BASE?: string
  /**
   * ICP 备案号（形如「粤ICP备12345678号-1」）。放在 `.env` 里而不是写进源码，
   * 是为了不让备案信息进入公开仓库；未配置时页面底部不显示备案号。
   */
  readonly VITE_ICP_LICENSE?: string
  /**
   * 公安联网备案号（形如「粤公网安备12345678901234号」）。同上，走环境变量。
   * 组件会从号码里取出数字段拼成公安部查询链接的 code 参数。
   */
  readonly VITE_PSB_LICENSE?: string
}
