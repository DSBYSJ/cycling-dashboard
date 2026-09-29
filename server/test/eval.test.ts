import test from 'node:test'
import assert from 'node:assert/strict'
import type { CoachReview } from '../src/ai/review.ts'
import { CASES } from '../eval/cases.ts'
import {
  checkActionable,
  checkCitesData,
  checkLength,
  checkMissingDimensions,
  checkNoCliches,
  checkNoFabrication,
  mentionsNumber,
  numericTokens,
  runChecks,
  summarize,
  type CaseReport,
} from '../eval/checks.ts'

/**
 * 评测逻辑自身的测试。
 *
 * 这层测试的存在理由很直接：**如果判定规则写错了，整份评测报告都是假的** ——
 * 它会告诉你"质量很好"，而实际输出一塌糊涂。所以判定规则必须先用
 * 「一条明确的好输出」和「一条明确的坏输出」对照验证过。
 */

const caseItem = CASES.find((item) => item.id === 'hot-long')!
assert.ok(caseItem, '评测用例 hot-long 必须存在，否则下面的对照没有基准')

/** 一条“像样”的输出：引用了数据、建议具体、不说套话 */
const good: CoachReview = {
  summary: '33.5℃ 下完成 62.4 公里，配速稳定但高温让整体评分降到 68。',
  highlights: ['平均速度 21.1 km/h，比上次 48.2 公里的 22.4 只慢了一点，耐热能力在提升'],
  improvements: [{ point: '补水不足', how: '33.5℃ 下每小时补 600ml，出发前先喝 400ml' }],
  nextGoal: '同样路线把平均速度回到 22 km/h',
  risk: '相对湿度 68%，注意电解质流失',
}

/** 一条“典型的水货输出”：套话 + 不引用数据 + 编造没测过的指标 */
const bad: CoachReview = {
  summary: '骑得不错，继续努力。',
  highlights: ['注意安全，保持良好的心态'],
  improvements: [{ point: '加强训练', how: '根据自己的情况循序渐进，贵在坚持' }],
  nextGoal: '多骑',
  risk: '这次平均心率 152，注意别超',
}

test('判定规则必须能区分好输出与水货输出（这层错了整份评测就是假的）', () => {
  const goodResults = runChecks(caseItem, good)
  assert.ok(
    goodResults.every((check) => check.passed),
    `好输出应全部通过，未通过的是：${goodResults.filter((c) => !c.passed).map((c) => `${c.name}(${c.detail})`).join('、')}`
  )

  // hot-long 这个用例的数据是全的，所以「未提及缺失维度」天然通过 ——
  // 排除它之后，水货输出应当一条检查都过不了
  const applicable = runChecks(caseItem, bad).filter((check) => check.name !== '未提及缺失维度')
  assert.ok(
    applicable.every((check) => !check.passed),
    `水货输出应全部不通过，却通过了：${applicable.filter((c) => c.passed).map((c) => c.name).join('、')}`
  )
})

test('缺失维度检查：输入里没有气温，输出却写「33.5℃」—— 这就是编造', () => {
  const sparse = CASES.find((item) => item.id === 'sparse-data')!
  const result = checkMissingDimensions(sparse, good)
  assert.equal(result.passed, false)
  assert.ok(result.detail.includes('气温'))
  assert.ok(result.detail.includes('湿度'))

  // 同一个用例里，数据齐全时不应误报
  assert.equal(checkMissingDimensions(caseItem, good).passed, true)
})

test('缺失维度检查：建议「补齐爬升数据」不算编造，报出「爬升 200 米」才算', () => {
  const sparse = CASES.find((item) => item.id === 'sparse-data')!

  // 真实模型在数据稀疏时的输出就是这样 —— 它做对了，规则不能冤枉它
  const advice: CoachReview = {
    summary: '12 公里，数据太少无法评估强度。',
    highlights: ['距离偏短'],
    improvements: [{ point: '数据缺失', how: '下次用码表补齐时长、均速、爬升' }],
    nextGoal: '补齐数据后再复盘',
    risk: null,
  }
  assert.equal(checkMissingDimensions(sparse, advice).passed, true)

  const invented: CoachReview = {
    ...advice,
    summary: '12 公里，爬升 200 米。',
  }
  const result = checkMissingDimensions(sparse, invented)
  assert.equal(result.passed, false)
  assert.ok(result.detail.includes('爬升'))
})

test('数字匹配必须用词边界：3 不能命中 33.5，12 不能命中 62.4', () => {
  assert.equal(mentionsNumber('气温 33.5℃', '3'), false)
  assert.equal(mentionsNumber('气温 33.5℃', '33.5'), true)
  assert.equal(mentionsNumber('完成 62.4 公里', '12'), false)
  assert.equal(mentionsNumber('完成 62.4 公里', '62.4'), true)
  // 前后是标点或空格时算独立出现
  assert.equal(mentionsNumber('爬升 412 米', '412'), true)
  assert.equal(mentionsNumber('评分68分', '68'), true)
})

test('数字抽取会过滤个位数 —— 风力 3 级这种没有区分力，到处都是', () => {
  const facts = { ...caseItem.facts, windLevel: 3, precipitation: 0 }
  const tokens = numericTokens(facts)
  assert.ok(!tokens.includes('3'), '个位数不应作为引用证据')
  assert.ok(!tokens.includes('0'))
  assert.ok(tokens.includes('62.4'))
})

test('引用数据：引用了一个真正属于本次数据的数值才算通过', () => {
  assert.equal(checkCitesData(caseItem, good).passed, true)

  // 输出里全是"别的数据"（另一个用例的数值），对本用例不算引用
  const other = CASES.find((item) => item.id === 'rainy')!
  assert.equal(checkCitesData(other, good).passed, false)

  const vague: CoachReview = {
    ...good,
    summary: '这次骑得很轻松。',
    highlights: ['状态不错'],
    improvements: [{ point: '继续保持', how: '每周多骑一次' }],
    nextGoal: '维持现状',
    risk: null,
  }
  const result = checkCitesData(caseItem, vague)
  assert.equal(result.passed, false)
  assert.ok(result.detail.includes('未引用'))
})

test('引用数据：数值从 facts 里抽取，空值不参与', () => {
  const tokens = numericTokens(caseItem.facts)
  assert.ok(tokens.includes('62.4'))
  assert.ok(tokens.includes('33.5'))
  assert.ok(tokens.includes('68')) // 综合评分
  assert.ok(!tokens.includes('null'))

  const sparse = CASES.find((item) => item.id === 'sparse-data')!
  assert.deepEqual(numericTokens(sparse.facts), ['12'])
})

test('套话黑名单：命中任意一条即不通过，并指出是哪一条', () => {
  const result = checkNoCliches(bad)
  assert.equal(result.passed, false)
  assert.ok(result.detail.includes('继续努力'))
  assert.ok(result.detail.includes('注意安全'))

  assert.equal(checkNoCliches(good).passed, true)
})

test('可执行性：只有数字或动作词都缺席时才算笼统', () => {
  assert.equal(checkActionable(good).passed, true)
  assert.equal(checkActionable(bad).passed, false)

  // 「每小时补 500ml」里有数字，「提前查一下天气」里有动作词 —— 两种都算合格
  const byWord: CoachReview = { ...good, improvements: [{ point: '时段', how: '提前出门避开正午' }] }
  assert.equal(checkActionable(byWord).passed, true)

  const noNumberNoWord: CoachReview = { ...good, improvements: [{ point: '状态', how: '慢慢就好了' }] }
  assert.equal(checkActionable(noNumberNoWord).passed, false)
})

test('编造检测：判据是「有没有断言已发生的事实」，不是「提到了什么词」', () => {
  assert.equal(checkNoFabrication(good).passed, true)

  // ✅ 建议里的专业术语一律不算编造。下面三条都是**真实模型的原话**：
  //    第一版规则把它们全判成编造（0/6）；第二版改成"看前文有无建议动词"，
  //    又冤枉了后两条（"用低踏频""高踏频"根本不需要动词）。现在用断言标记判定
  const advice: CoachReview = {
    ...good,
    improvements: [
      { point: '频率', how: '平路段保持踏频 85-95 转/分，每 10 分钟对照码表' },
      { point: '爬坡', how: '下次用低踏频大齿比爬坡，至少完成 3 段' },
      { point: '间歇', how: '平路段做 4 组高踏频（100-110rpm）间歇' },
    ],
  }
  assert.equal(checkNoFabrication(advice).passed, true)

  // ❌ 断言本次骑行未测量的指标才算编造
  const claimed: CoachReview = { ...good, summary: '这次骑行平均心率 152，偏高。' }
  const result = checkNoFabrication(claimed)
  assert.equal(result.passed, false)
  assert.ok(result.detail.includes('心率'))

  assert.equal(checkNoFabrication({ ...good, nextGoal: '你的平均踏频偏低，要提到 90' }).passed, false)

  // ❌ 编造背景信息：输入里只有骑行数据，没有车型、装备、同伴
  assert.equal(checkNoFabrication({ ...good, nextGoal: '给你的车胎换一套更轻的' }).passed, false)

  // 大小写不敏感
  assert.equal(checkNoFabrication({ ...good, summary: '本次 FTP 偏低。' }).passed, false)
})

test('篇幅：过短视为敷衍', () => {
  assert.equal(checkLength(good).passed, true)
  assert.equal(checkLength(bad).passed, false)
})

test('汇总：按检查项统计通过数，并给出 token 与耗时', () => {
  const reports: CaseReport[] = [
    {
      caseId: 'a',
      intent: 'x',
      source: 'model',
      attempts: 1,
      durationMs: 1000,
      promptTokens: 300,
      completionTokens: 200,
      checks: runChecks(caseItem, good),
      review: good,
      error: null,
    },
    {
      caseId: 'b',
      intent: 'y',
      source: 'model',
      attempts: 2,
      durationMs: 3000,
      promptTokens: 300,
      completionTokens: 200,
      checks: runChecks(caseItem, bad),
      review: bad,
      error: null,
    },
  ]

  const summary = summarize(reports)
  assert.equal(summary.total, 2)
  assert.equal(summary.passedCases, 1)
  assert.equal(summary.totalTokens, 1000)
  assert.equal(summary.avgDurationMs, 2000)

  const clicheRow = summary.byCheck.find((item) => item.name === '无空洞套话')
  assert.deepEqual(clicheRow, { name: '无空洞套话', passed: 1, total: 2 })
})

test('评测用例集本身要保持小而全：6 条，且包含数据稀疏这一关键场景', () => {
  assert.equal(CASES.length, 6)
  assert.equal(new Set(CASES.map((item) => item.id)).size, 6, '用例 id 不能重复')
  const sparse = CASES.find((item) => item.id === 'sparse-data')!
  // 数据稀疏用例的存在意义就是测“会不会硬编”，它必须真的只有一项数据
  assert.equal(numericTokens(sparse.facts).length, 1)
  assert.equal(sparse.facts.temperature, null)
  assert.equal(sparse.facts.aqi, null)
})
