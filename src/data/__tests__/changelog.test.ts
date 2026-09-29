import { describe, expect, it } from 'vitest'
import { CHANGELOG } from '../changelog'
import { APP_VERSION } from '../../version'

/** semver 比较：a > b 返回正数 */
function cmp(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

describe('CHANGELOG', () => {
  it('第一条的版本号等于当前应用版本 —— 升版本号必须同步更新 changelog', () => {
    expect(CHANGELOG[0].version).toBe(APP_VERSION)
  })

  it('按版本倒序排列（最新在前）', () => {
    const versions = CHANGELOG.map((e) => e.version)
    for (let i = 0; i < versions.length - 1; i++) {
      expect(cmp(versions[i], versions[i + 1])).toBeGreaterThan(0)
    }
  })

  it('每个版本都有合法版本号、日期，且至少一组非空条目', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0)
    for (const entry of CHANGELOG) {
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry.groups.length).toBeGreaterThan(0)
      for (const group of entry.groups) {
        expect(group.items.length).toBeGreaterThan(0)
        for (const item of group.items) expect(item.trim()).not.toBe('')
      }
    }
  })
})
