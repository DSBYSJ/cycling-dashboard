import { useEffect, useState } from 'react'
import { api } from '../api/client'

/** 模块级缓存：同一页面即便渲染多处版本号，也只会向后端问一次 */
let cached: boolean | null = null

/**
 * 「是否显示更新日志入口」开关。
 *
 * 值来自后台设置（`GET /api/auth/config` 的 `changelogEnabled`），
 * 拿不到时**按开启显示** —— 更新日志是纯前端静态内容，不依赖后端，
 * 离线时宁可多给一个入口，也不要因为一次请求失败就把它藏掉。
 */
export function useChangelogEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(cached ?? true)

  useEffect(() => {
    if (cached !== null) return
    let alive = true
    api
      .authConfig()
      .then((cfg) => {
        cached = cfg.changelogEnabled
        if (alive) setEnabled(cfg.changelogEnabled)
      })
      .catch(() => {
        // 后端不可达：保持默认 true，入口照常显示
      })
    return () => {
      alive = false
    }
  }, [])

  return enabled
}
