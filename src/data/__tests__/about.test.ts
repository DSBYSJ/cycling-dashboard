import { describe, expect, it } from 'vitest'
import {
  COMPLIANCE_NOTE,
  FEATURE_GROUPS,
  PRINCIPLES,
  SITE_INTRO,
  SITE_TAGLINE,
  TECH_LAYERS,
} from '../about'
// 直接读组件源码文本：这条约束针对的是"界面上出现什么字"，源码检查比渲染测试更直接
import routeReviewsSource from '../../components/RouteReviews.tsx?raw'

/** 把所有对外文案拍平成一条数组，方便整体检查 */
function allTexts(): string[] {
  return [
    SITE_TAGLINE,
    ...SITE_INTRO,
    ...FEATURE_GROUPS.flatMap((g) => [g.title, g.summary, ...g.items]),
    ...TECH_LAYERS.flatMap((l) => [l.name, ...l.stack]),
    ...PRINCIPLES,
    COMPLIANCE_NOTE,
  ]
}

describe('关于页内容', () => {
  it('定位与简介都有内容', () => {
    expect(SITE_TAGLINE.trim().length).toBeGreaterThan(0)
    expect(SITE_INTRO.length).toBeGreaterThan(0)
    expect(SITE_INTRO.every((p) => p.trim().length > 0)).toBe(true)
  })

  it('功能分组：id 唯一，标题 / 说明 / 条目齐全', () => {
    const ids = FEATURE_GROUPS.map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const group of FEATURE_GROUPS) {
      expect(group.title.trim().length).toBeGreaterThan(0)
      expect(group.summary.trim().length).toBeGreaterThan(0)
      expect(group.items.length).toBeGreaterThan(0)
      expect(group.items.every((item) => item.trim().length > 0)).toBe(true)
    }
  })

  it('技术分层：名称唯一，每层都列出了内容', () => {
    const names = TECH_LAYERS.map((l) => l.name)
    expect(new Set(names).size).toBe(names.length)
    for (const layer of TECH_LAYERS) {
      expect(layer.stack.length).toBeGreaterThan(0)
      expect(layer.stack.every((entry) => entry.trim().length > 0)).toBe(true)
    }
  })

  it('设计取舍与合规声明都有内容', () => {
    expect(PRINCIPLES.length).toBeGreaterThan(0)
    expect(PRINCIPLES.every((p) => p.trim().length > 0)).toBe(true)
    expect(COMPLIANCE_NOTE.trim().length).toBeGreaterThan(0)
  })

  it('不出现「即将 / 计划中 / 待开放」这类未完成的表述', () => {
    // 这是一个对外页面：只讲已经做完的事，避免把 roadmap 当成成果展示
    for (const text of allTexts()) {
      expect(text).not.toMatch(/即将|计划中|待开放|敬请期待|TODO/)
    }
  })

  it('路线评价组件不得出现 UGC 预留表述 —— 个人备案不能有评论区，这不是"待开放"而是不开放', () => {
    // 历史教训：这里曾放着一个「其他骑友的评分与评论 · 待开放」占位，
    // 等于对外宣示"计划提供 UGC"。这条用例防止它以任何形式回来。
    expect(routeReviewsSource).not.toMatch(/待开放|其他骑友|骑友评分|敬请期待|社区数据|将展示真实评价/)
  })
})
