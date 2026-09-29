import process from 'node:process'
import { loadConfig } from '../src/config.ts'
import type { AiConfig } from '../src/ai/deepseek.ts'
import { generateCoachReview } from '../src/ai/coach.ts'
import { CASES } from './cases.ts'
import { runChecks, summarize, type CaseReport } from './checks.ts'

/**
 * 跑一遍输出质量评测。
 *
 *   cd server && npm run eval
 *
 * 用法要点：
 *   · **每次都会真实调用模型**（缓存键带时间戳），所以能反映当前 prompt 的真实水平
 *   · 有任一用例不达标 → 退出码 1，因此可以直接挂进 CI：
 *     改 prompt 的提交如果让质量退步，流水线会拦下来
 *   · 输出 Markdown，方便贴进 PR 描述或存档对比
 *
 * 成本：6 条用例，每次约 2~4 千 token。改 prompt 时跑一下是可接受的。
 */

const aiConfig: AiConfig = (() => {
  const config = loadConfig()
  return {
    apiKey: config.deepseekApiKey,
    baseUrl: config.deepseekBaseUrl,
    model: config.deepseekModel,
    timeoutMs: config.deepseekTimeoutMs,
  }
})()

if (!aiConfig.apiKey) {
  console.error('未配置 DEEPSEEK_API_KEY，无法跑评测。请在 server/.env 里设置后再执行。')
  process.exit(2)
}

const reports: CaseReport[] = []

for (const caseItem of CASES) {
  process.stderr.write(`· ${caseItem.id} …`)
  // 缓存键带时间戳：评测必须真的打到模型，命中缓存就失去意义了
  const outcome = await generateCoachReview(aiConfig, caseItem.facts, `eval:${caseItem.id}@${Date.now()}`)
  const report: CaseReport = {
    caseId: caseItem.id,
    intent: caseItem.intent,
    source: outcome.source,
    attempts: outcome.attempts,
    durationMs: outcome.durationMs,
    promptTokens: outcome.usage?.promptTokens ?? 0,
    completionTokens: outcome.usage?.completionTokens ?? 0,
    checks: outcome.review ? runChecks(caseItem, outcome.review) : [],
    review: outcome.review,
    error: outcome.fallbackReason,
  }
  reports.push(report)
  const mark = report.source === 'model' && report.checks.every((check) => check.passed) ? 'ok' : 'FAIL'
  process.stderr.write(` ${mark}\n`)
}

const summary = summarize(reports)
const passMark = (passed: boolean): string => (passed ? '通过' : '**未通过**')

const lines: string[] = []
lines.push('# AI 骑行教练 · 输出质量评测', '')
lines.push(`- 模型：\`${aiConfig.model}\``)
lines.push(`- 用例：${summary.total} 个，全部检查通过：**${summary.passedCases}** 个`)
lines.push(`- token 合计：${summary.totalTokens}`)
lines.push(`- 平均耗时：${summary.avgDurationMs} ms`, '')
lines.push('## 逐项通过率', '')
lines.push('| 检查项 | 通过 |', '| --- | --- |')
for (const item of summary.byCheck) {
  lines.push(`| ${item.name} | ${item.passed}/${item.total} |`)
}
lines.push('', '## 用例明细', '')

for (const report of reports) {
  const ok = report.source === 'model' && report.checks.every((check) => check.passed)
  lines.push(`### ${report.caseId} — ${passMark(ok)}`, '')
  lines.push(`意图：${report.intent}`, '')
  if (report.source === 'fallback') {
    lines.push(`⚠️ 降级到规则引擎：${report.error ?? '未知原因'}`, '')
    continue
  }
  lines.push(`耗时 ${report.durationMs}ms · 尝试 ${report.attempts} 次 · token ${report.promptTokens}+${report.completionTokens}`, '')
  for (const check of report.checks) {
    lines.push(`- ${passMark(check.passed)} ${check.name} —— ${check.detail}`)
  }
  if (report.review) {
    lines.push('', `> ${report.review.summary}`)
    for (const item of report.review.improvements) {
      lines.push(`> - ${item.point}：${item.how}`)
    }
  }
  lines.push('')
}

process.stdout.write(lines.join('\n') + '\n')

// 退出码决定能否挂进 CI：改 prompt 让质量退步时，流水线应当拦下来
process.exit(summary.passedCases === summary.total ? 0 : 1)
