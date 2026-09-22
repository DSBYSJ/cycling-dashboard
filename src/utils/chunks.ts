/**
 * 把数组按「估算体积」切成若干块。
 *
 * 为什么需要：批量上传接口一次最多 5000 条，但真正先撞上的是**请求体大小上限**
 * （后端 8MB、Nginx 50m）。一条带 5000 个轨迹点的骑行记录 JSON 就有 200KB 左右，
 * 40 条就能超过 8MB —— 只按条数切块会直接吃到 413。
 * 所以这里同时受「条数」和「估算字节数」两个条件约束。
 */

/** 留出余量：后端 bodyLimit 是 8MB，这里按 4MB 切，避免估算误差越界 */
export const DEFAULT_MAX_CHUNK_BYTES = 4 * 1024 * 1024
export const DEFAULT_MAX_CHUNK_ITEMS = 5_000

/** 用 JSON 序列化长度近似一条数据的网络体积 */
export function estimateItemBytes(item: unknown): number {
  try {
    return JSON.stringify(item)?.length ?? 0
  } catch {
    return 0
  }
}

export function chunkByPayloadSize<T>(
  items: T[],
  maxBytes: number = DEFAULT_MAX_CHUNK_BYTES,
  maxItems: number = DEFAULT_MAX_CHUNK_ITEMS
): T[][] {
  const chunks: T[][] = []
  let current: T[] = []
  let bytes = 0

  for (const item of items) {
    const size = estimateItemBytes(item)
    const wouldExceed =
      current.length > 0 && (current.length >= maxItems || bytes + size > maxBytes)
    if (wouldExceed) {
      chunks.push(current)
      current = []
      bytes = 0
    }
    current.push(item)
    bytes += size
  }

  if (current.length > 0) chunks.push(current)
  return chunks
}
