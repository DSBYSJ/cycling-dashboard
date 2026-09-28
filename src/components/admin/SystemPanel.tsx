import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { adminApi } from '../../api/client'
import { EmptyState, ErrorNote, Loading, OkNote, Panel, useAsync, useFlash } from './ui'

const SMALL_BTN =
  'rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-t2 transition hover:bg-fill disabled:opacity-50'

const LINE_OPTIONS = [100, 200, 500, 1000]

/** 系统日志：只读最后若干行（最多回读 256KB，避免大日志把内存吃掉） */
export default function SystemPanel() {
  const [lines, setLines] = useState(200)
  const { data, loading, error, reload } = useAsync(() => adminApi.logs(lines), [lines])
  const { flash, show } = useFlash()

  async function copyAll() {
    if (!data?.lines.length) return
    try {
      await navigator.clipboard.writeText(data.lines.join('\n'))
      show('ok', '已复制到剪贴板')
    } catch {
      show('error', '复制失败，请手动选中复制')
    }
  }

  return (
    <div className="space-y-4">
      {flash && (flash.type === 'ok' ? <OkNote>{flash.text}</OkNote> : <ErrorNote>{flash.text}</ErrorNote>)}

      <Panel
        title="后端日志"
        description="显示最新的若干行。要翻更早的日志，去宝塔面板的文件里看。"
        actions={
          <div className="flex items-center gap-2">
            <select className="field-input w-auto" value={lines} onChange={(e) => setLines(Number(e.target.value))}>
              {LINE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  最近 {n} 行
                </option>
              ))}
            </select>
            <button type="button" className={SMALL_BTN} onClick={reload} disabled={loading}>
              <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden="true" />
              刷新
            </button>
          </div>
        }
      >
        {loading && <Loading />}
        {error && !loading && <ErrorNote>加载失败：{error}</ErrorNote>}

        {data && !loading && (
          <>
            {!data.configured ? (
              <EmptyState>{data.hint ?? '未配置日志文件路径'}</EmptyState>
            ) : data.lines.length === 0 ? (
              <EmptyState>{data.hint ?? '日志文件是空的'}</EmptyState>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-t5">
                  <span className="font-mono">{data.file}</span>
                  <button type="button" className="underline" onClick={() => void copyAll()}>
                    复制全部
                  </button>
                </div>
                <pre className="max-h-[32rem] overflow-auto rounded-lg border border-line bg-fill/40 p-3 font-mono text-[10px] leading-4 text-t3">
                  {data.lines.join('\n')}
                </pre>
              </>
            )}
          </>
        )}
      </Panel>
    </div>
  )
}
