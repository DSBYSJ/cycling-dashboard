import { describe, expect, it } from 'vitest'
import { chunkByPayloadSize, estimateItemBytes } from '../chunks'

/** 造一条「体积可控」的假记录 */
function item(id: string, payloadBytes: number) {
  return { id, payload: 'x'.repeat(payloadBytes) }
}

describe('chunkByPayloadSize 批量上传切块', () => {
  it('空数组不产生任何块', () => {
    expect(chunkByPayloadSize([])).toEqual([])
  })

  it('小数据只有一块', () => {
    const items = [item('a', 10), item('b', 10)]
    const chunks = chunkByPayloadSize(items, 1024, 100)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toHaveLength(2)
  })

  it('按条数上限切分', () => {
    const items = Array.from({ length: 7 }, (_, i) => item(String(i), 1))
    const chunks = chunkByPayloadSize(items, 10 * 1024 * 1024, 3)
    expect(chunks.map((c) => c.length)).toEqual([3, 3, 1])
  })

  it('按体积上限切分（这才是 8MB 请求体的真正约束）', () => {
    // 每条约 1000 字节，上限 2500 → 每块最多 2 条
    const items = Array.from({ length: 5 }, (_, i) => item(String(i), 1000))
    const chunks = chunkByPayloadSize(items, 2500, 1000)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      const bytes = chunk.reduce((sum, it) => sum + estimateItemBytes(it), 0)
      // 单条就不可能超上限的情况除外，每块都不该超过上限
      expect(bytes).toBeLessThanOrEqual(2500)
    }
  })

  it('单条就超过上限时让它自成一块，而不是死循环或丢数据', () => {
    const items = [item('huge', 5000), item('small', 1)]
    const chunks = chunkByPayloadSize(items, 1000, 100)
    expect(chunks).toHaveLength(2)
    expect(chunks[0][0].id).toBe('huge')
    expect(chunks[1][0].id).toBe('small')
  })

  it('不丢数据、不改顺序', () => {
    const items = Array.from({ length: 50 }, (_, i) => item(String(i), i * 37))
    const chunks = chunkByPayloadSize(items, 4096, 8)
    const flat = chunks.flat()
    expect(flat).toHaveLength(items.length)
    expect(flat.map((x) => x.id)).toEqual(items.map((x) => x.id))
  })

  it('estimateItemBytes 对无法序列化的值返回 0 而不是抛错', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(estimateItemBytes(cyclic)).toBe(0)
    expect(estimateItemBytes(undefined)).toBe(0)
  })
})
