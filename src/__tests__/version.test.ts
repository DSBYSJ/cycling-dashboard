import { describe, expect, it } from 'vitest'
import { APP_VERSION } from '../version'

describe('APP_VERSION', () => {
  it('是形如 1.0.0 的语义化版本号', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  /**
   * 这条守的是「注入链路断了」这个静默故障：
   * vite.config.ts 的 define 一旦失效（改配置、换打包方式），
   * 页面会安安静静显示 `vdev` —— 版本号还在，实际已经失去意义。
   * 所以这里必须断言它拿到了 package.json 里的真值。
   */
  it('取到的是注入值，而不是兜底的 dev', () => {
    expect(APP_VERSION).not.toBe('dev')
  })
})
