import { useCallback, useEffect, useState } from 'react'

export type TabId = 'record' | 'dashboard' | 'bikes' | 'admin'

const TAB_IDS: TabId[] = ['record', 'dashboard', 'bikes', 'admin']
const DEFAULT_TAB: TabId = 'record'

/** 解析 location.hash(支持 #record 与 #/record 两种写法),非法值回落到默认分页 */
function parseHash(): TabId {
  if (typeof window === 'undefined') return DEFAULT_TAB
  const raw = window.location.hash.replace(/^#\/?/, '')
  return (TAB_IDS as string[]).includes(raw) ? (raw as TabId) : DEFAULT_TAB
}

/**
 * 分页状态与 URL hash 双向同步:
 * 刷新后停留在当前分页、链接可分享收藏,并且为安卓 App 的物理返回键提供历史记录
 * (后续接 Capacitor 时无需再改这一层)。
 */
export function useTabRoute() {
  const [tab, setTab] = useState<TabId>(parseHash)

  useEffect(() => {
    // 首次进入补全 hash,避免分享出去的链接缺少分页信息
    if (!window.location.hash) window.history.replaceState(null, '', `#/${tab}`)
    const onHashChange = () => setTab(parseHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
    // 仅在挂载时执行一次:后续变化由 hashchange 事件驱动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const navigate = useCallback((next: TabId) => {
    if (parseHash() === next) {
      setTab(next)
      return
    }
    window.location.hash = `#/${next}`
  }, [])

  return { tab, navigate }
}
