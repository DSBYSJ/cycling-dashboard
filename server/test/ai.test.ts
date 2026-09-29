import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { loadConfig } from '../src/config.ts'
import { openDatabase, type Database } from '../src/db/index.ts'
import { buildApp } from '../src/app.ts'
import type { RideRecord } from '../../src/types.ts'
import { buildMessages, buildRideFacts, renderFacts } from '../src/ai/prompt.ts'
import { ReviewFormatError, parseCoachReview } from '../src/ai/review.ts'
import { coachCacheKey, coachCacheSize, clearCoachCache, generateCoachReview } from '../src/ai/coach.ts'
import { clearAiCalls, aiCallStats } from '../src/ai/metrics.ts'
import type { AiConfig } from '../src/ai/deepseek.ts'

/**
 * AI 骑行教练测试。
 *
 * 三块分别验证：
 *   1. 上下文压缩与 prompt 组装（纯函数）
 *   2. 结构化输出的容错解析与严格校验
 *   3. 编排层：缓存命不命中、格式错误会不会重试、失败能不能降级
 * 最后一块是 HTTP 集成：权限边界（只有管理员可用）与未配 Key 时的表现。
 *
 * 全程**不联网** —— fetch 一律注入 mock。否则用例会随着 API 余额和网络抖动变成 flaky 测试。
 */

/* ==================== 夹具 ==================== */

/** 造一条"丰满"的记录：2 万个轨迹点 + 全部字段都有值 */
function fullRide(): RideRecord {
  return {
    id: 'r1',
    label: '周末长距离',
    date: '2026-09-28',
    durationMin: 95.4,
    distanceKm: 32.456,
    avgSpeed: 20.512,
    maxSpeed: 41.987,
    cityName: '广州',
    cityCode: '101280101',
    location: { lat: 23.12, lon: 113.32 },
    env: {
      temperature: 27.66,
      windLevel: 3,
      humidity: 72.4,
      precipitation: 0,
      precipitationProbability: 20,
      aqi: 48.2,
      pm25: 30,
    },
    envMeta: { weatherFetched: true, aqiFetched: true, manualEdited: false },
    route: { elevationGain: 320.7, avgGrade: 3.25, surface: 'asphalt', traffic: 'medium' },
    track: Array.from({ length: 20_000 }, (_, i) => ({
      lat: 23.1 + i * 1e-5,
      lon: 113.3 + i * 1e-5,
      ele: 10 + (i % 50),
      time: '2026-09-28T07:00:00Z',
    })),
    speedSeries: [],
    scores: { total: 78, weather: 82, route: 71, rainFactor: 0 },
    comment: '整体条件不错，适合按计划骑行。',
    suggestions: ['平均坡度较陡，注意变速节奏与爬坡补水。'],
    notes: '',
    createdAt: 1,
    updatedAt: 2,
  }
}

const GOOD_REVIEW = JSON.stringify({
  summary: '高温下完成了 32 公里的稳定输出，配速控制得不错。',
  highlights: ['平均坡度 3.3% 仍保持 20.5 km/h，爬坡节奏稳'],
  improvements: [{ point: '补水不足', how: '气温 27.7℃ 下每小时应补 500ml，下次带两壶' }],
  nextGoal: '同样路线把平均速度提到 21 km/h',
  risk: '湿度 72%，注意电解质补充',
})

function deepseekOk(content = GOOD_REVIEW) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 320, completion_tokens: 180 },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** 可注入的 fetch：记录每次请求体，便于断言"到底调了几次" */
function makeFetch(handler: (callIndex: number, body: { messages?: { content: string }[] }) => Response) {
  const bodies: { messages?: { content: string }[] }[] = []
  const fn = (async (_input: unknown, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
    const response = handler(bodies.length, body)
    bodies.push(body)
    return response
  }) as unknown as typeof fetch
  return { fn, bodies }
}

const aiConfig: AiConfig = {
  apiKey: 'sk-test-not-a-real-key',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  timeoutMs: 5_000,
}

const noSleep = async (): Promise<void> => {}

beforeEach(() => {
  clearCoachCache()
  clearAiCalls()
})

/* ==================== 1. 上下文压缩与 prompt ==================== */

test('上下文压缩：2 万个轨迹点被剥掉，体积降三个数量级', () => {
  const ride = fullRide()
  const facts = buildRideFacts(ride, [])

  // 原始记录（含轨迹）体积以 MB 计，压缩后应在 1KB 以内
  const rawSize = JSON.stringify(ride).length
  const factsSize = JSON.stringify(facts).length
  assert.ok(rawSize > 1_000_000, `原始记录应超过 1MB，实际 ${rawSize}`)
  assert.ok(factsSize < 1_000, `压缩后应小于 1KB，实际 ${factsSize}`)
  assert.ok(rawSize / factsSize > 1_000, `压缩比应超过 1000 倍，实际 ${Math.round(rawSize / factsSize)}`)

  // 轨迹、逐点速度这些"点数级"的字段一个都不能带进 prompt
  assert.equal('track' in facts, false)
  assert.equal('speedSeries' in facts, false)
  assert.equal('location' in facts, false)
})

test('上下文压缩：数值收敛到 1 位小数，缺失项保持 null 而不是变成 0', () => {
  const ride = fullRide()
  const facts = buildRideFacts(ride, [])

  assert.equal(facts.distanceKm, 32.5)
  assert.equal(facts.avgSpeed, 20.5)
  assert.equal(facts.maxSpeed, 42)
  assert.equal(facts.durationMin, 95)
  assert.equal(facts.elevationGain, 321)

  // 缺数据 ≠ 数据是 0。把 null 变成 0 会让模型得出"没爬升""气温 0 度"的错误结论
  const sparse = buildRideFacts({ ...ride, distanceKm: null, env: { ...ride.env, aqi: null } }, [])
  assert.equal(sparse.distanceKm, null)
  assert.equal(sparse.aqi, null)
})

test('上下文压缩：枚举值翻译成中文，历史对比最多带 5 条', () => {
  const ride = fullRide()
  const facts = buildRideFacts(ride, [])

  assert.equal(facts.surface, '柏油路')
  assert.equal(facts.traffic, '中')

  const history = Array.from({ length: 9 }, (_, i) => ({ ...fullRide(), id: `h${i}`, date: `2026-09-0${i + 1}` }))
  assert.equal(buildRideFacts(ride, history).history.length, 5)
})

test('prompt 渲染：空缺的分组写「(无数据)」，不写"未知"诱导模型编造', () => {
  const ride = fullRide()
  const noEnv = buildRideFacts({ ...ride, env: { ...ride.env, temperature: null, humidity: null, windLevel: null, precipitation: null, precipitationProbability: null, aqi: null } }, [])

  const text = renderFacts(noEnv)
  assert.ok(text.includes('(无数据)'))
  assert.ok(!text.includes('未知'))
  // 用「标签: 值」的形式判断，避免误伤评分口径说明里的“天气看气温/空气质量”那句
  assert.ok(!/气温:\s/.test(text), '空缺项不应渲染成「气温: …」这样的行')
  assert.ok(!/空气质量 AQI:\s/.test(text))
})

test('prompt 渲染：历史对比与规则引擎结论都带上（后者是降级兜底，也是模型的参考基线）', () => {
  const ride = fullRide()
  const facts = buildRideFacts(ride, [{ ...fullRide(), id: 'h1', date: '2026-09-21', distanceKm: 28.1, avgSpeed: 19.2 }])

  const text = renderFacts(facts)
  assert.ok(text.includes('历史对比'))
  assert.ok(text.includes('2026-09-21'))
  assert.ok(text.includes('2026-09-28'))
  assert.ok(text.includes('规则引擎'))
  assert.ok(text.includes('整体条件不错'))
})

test('prompt 组装：system 明确要求只输出 JSON 且禁止编造未提供的信息', () => {
  const messages = buildMessages(buildRideFacts(fullRide(), []))

  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'system')
  assert.equal(messages[1].role, 'user')
  // DeepSeek 开启 response_format=json_object 时，prompt 里必须出现 "JSON" 字样
  assert.ok(messages[0].content.includes('JSON'))
  assert.ok(messages[0].content.includes('不要编造'))
  assert.ok(messages[1].content.includes('请只返回 JSON'))
})

/* ==================== 2. 结构化输出解析与校验 ==================== */

test('解析：标准 JSON 直接通过', () => {
  const review = parseCoachReview(GOOD_REVIEW)
  assert.equal(review.summary, '高温下完成了 32 公里的稳定输出，配速控制得不错。')
  assert.equal(review.highlights.length, 1)
  assert.equal(review.improvements[0].point, '补水不足')
  assert.equal(review.risk, '湿度 72%，注意电解质补充')
})

test('解析：容忍 ```json 代码块与前后废话（模型最常见的两种"不听话"）', () => {
  const wrapped = '```json\n' + GOOD_REVIEW + '\n```'
  assert.equal(parseCoachReview(wrapped).summary, parseCoachReview(GOOD_REVIEW).summary)

  const chatty = `好的，以下是复盘结果：\n${GOOD_REVIEW}\n希望对你有所帮助！`
  assert.equal(parseCoachReview(chatty).summary, parseCoachReview(GOOD_REVIEW).summary)
})

test('解析：不是 JSON 就抛错，绝不返回半成品', () => {
  assert.throws(() => parseCoachReview('我觉得这次骑得挺好的'), ReviewFormatError)
  assert.throws(() => parseCoachReview(''), ReviewFormatError)
  assert.throws(() => parseCoachReview('[1,2,3]'), ReviewFormatError)
})

test('解析：缺字段 / 类型错都抛错（宁可降级，也不给用户一张缺角的卡片）', () => {
  assert.throws(() => parseCoachReview('{"highlights":["a"],"improvements":[{"point":"p","how":"h"}],"nextGoal":"g"}'), /summary/)
  assert.throws(
    () => parseCoachReview('{"summary":"s","highlights":"不是数组","improvements":[{"point":"p","how":"h"}],"nextGoal":"g"}'),
    /highlights/
  )
  assert.throws(
    () => parseCoachReview('{"summary":"s","highlights":["a"],"improvements":[],"nextGoal":"g"}'),
    /improvements/
  )
  assert.throws(
    () => parseCoachReview('{"summary":"  ","highlights":["a"],"improvements":[{"point":"p","how":"h"}],"nextGoal":"g"}'),
    /summary/
  )
})

test('解析：improvements 里混入非法项时跳过该项，但至少要剩一条', () => {
  const mixed = JSON.stringify({
    summary: 's',
    highlights: ['a'],
    improvements: [
      { point: 'p1', how: 'h1' },
      { point: 'p2' }, // 缺 how
      '整条是字符串',
      { point: '', how: 'h' },
      { point: 'p3', how: 'h3' },
    ],
    nextGoal: 'g',
  })
  const review = parseCoachReview(mixed)
  assert.deepEqual(
    review.improvements.map((item) => item.point),
    ['p1', 'p3']
  )

  const allBad = JSON.stringify({ summary: 's', highlights: ['a'], improvements: ['x'], nextGoal: 'g' })
  assert.throws(() => parseCoachReview(allBad), /improvements/)
})

test('解析：超长字段被截断，防止一句跑飞的话把前端布局撑破', () => {
  const long = JSON.stringify({
    summary: '啊'.repeat(500),
    highlights: ['呀'.repeat(500)],
    improvements: [{ point: '嗯'.repeat(500), how: '哈'.repeat(500) }],
    nextGoal: '哦'.repeat(500),
    risk: '咦'.repeat(500),
  })
  const review = parseCoachReview(long)
  assert.ok(review.summary.length <= 120)
  assert.ok(review.highlights[0].length <= 80)
  assert.ok(review.improvements[0].how.length <= 140)
  assert.ok((review.risk?.length ?? 0) <= 80)
})

test('解析：risk 为 null / "null" / 空串时统一成 null', () => {
  const build = (risk: unknown) =>
    JSON.stringify({ summary: 's', highlights: ['a'], improvements: [{ point: 'p', how: 'h' }], nextGoal: 'g', risk })
  assert.equal(parseCoachReview(build(null)).risk, null)
  assert.equal(parseCoachReview(build('null')).risk, null)
  assert.equal(parseCoachReview(build('  ')).risk, null)
  assert.equal(parseCoachReview(build('注意路滑')).risk, '注意路滑')
})

/* ==================== 3. 编排：缓存 / 重试 / 降级 ==================== */

test('编排：首次成功返回模型结果并写入缓存，第二次直接命中缓存不再请求', async () => {
  const facts = buildRideFacts(fullRide(), [])
  const key = coachCacheKey('r1', 2)
  const { fn, bodies } = makeFetch(() => jsonResponse(deepseekOk()))

  const first = await generateCoachReview(aiConfig, facts, key, { fetchImpl: fn, sleep: noSleep })
  assert.equal(first.source, 'model')
  assert.equal(first.cached, false)
  assert.equal(first.attempts, 1)
  assert.equal(first.review?.summary, parseCoachReview(GOOD_REVIEW).summary)
  assert.equal(first.usage?.promptTokens, 320)
  assert.equal(first.usage?.completionTokens, 180)
  assert.equal(bodies.length, 1)

  const second = await generateCoachReview(aiConfig, facts, key, { fetchImpl: fn, sleep: noSleep })
  assert.equal(second.cached, true)
  assert.equal(second.attempts, 0)
  assert.equal(bodies.length, 1, '命中缓存后不应再发起请求')
  assert.equal(coachCacheSize(), 1)
})

test('编排：记录被编辑（updatedAt 变化）后缓存自动失效并重新生成', async () => {
  const facts = buildRideFacts(fullRide(), [])
  const { fn, bodies } = makeFetch(() => jsonResponse(deepseekOk()))

  await generateCoachReview(aiConfig, facts, coachCacheKey('r1', 2), { fetchImpl: fn, sleep: noSleep })
  await generateCoachReview(aiConfig, facts, coachCacheKey('r1', 3), { fetchImpl: fn, sleep: noSleep })
  assert.equal(bodies.length, 2)
})

test('编排：首次返回格式非法时，追问一轮让模型自己纠正', async () => {
  const facts = buildRideFacts(fullRide(), [])
  const { fn, bodies } = makeFetch((index) =>
    index === 0 ? jsonResponse(deepseekOk('这次骑得不错，建议多喝水。')) : jsonResponse(deepseekOk())
  )

  const outcome = await generateCoachReview(aiConfig, facts, coachCacheKey('r1', 2), { fetchImpl: fn, sleep: noSleep })

  assert.equal(outcome.source, 'model')
  assert.equal(outcome.attempts, 2)
  assert.equal(bodies.length, 2)
  // 第二轮要把"上一次哪里不合法"讲清楚，模型才知道怎么改
  const retryText = JSON.stringify(bodies[1])
  assert.ok(retryText.includes('无法解析'))
  assert.ok(retryText.includes('只输出一个 JSON 对象'))
})

test('编排：两轮都不合法就降级到规则引擎，且不抛错', async () => {
  const facts = buildRideFacts(fullRide(), [])
  const { fn, bodies } = makeFetch(() => jsonResponse(deepseekOk('抱歉，我无法完成这个请求')))

  const outcome = await generateCoachReview(aiConfig, facts, coachCacheKey('r1', 2), { fetchImpl: fn, sleep: noSleep })

  assert.equal(outcome.source, 'fallback')
  assert.equal(outcome.review, null)
  assert.equal(outcome.attempts, 2)
  assert.equal(bodies.length, 2)
  assert.ok(outcome.fallbackReason && outcome.fallbackReason.length > 0)
})

test('编排：401（Key 无效）不重试 —— 重试只是白花时间', async () => {
  const facts = buildRideFacts(fullRide(), [])
  const { fn, bodies } = makeFetch(() => jsonResponse({ error: { message: 'Authentication Fails' } }, 401))

  const outcome = await generateCoachReview(aiConfig, facts, coachCacheKey('r1', 2), { fetchImpl: fn, sleep: noSleep })

  assert.equal(outcome.source, 'fallback')
  assert.equal(outcome.attempts, 1)
  assert.equal(bodies.length, 1)
  assert.ok(outcome.fallbackReason?.includes('401'))
})

test('编排：429 限流会退避后重试', async () => {
  const facts = buildRideFacts(fullRide(), [])
  let slept = 0
  const { fn, bodies } = makeFetch((index) => (index === 0 ? jsonResponse({}, 429) : jsonResponse(deepseekOk())))

  const outcome = await generateCoachReview(aiConfig, facts, coachCacheKey('r1', 2), {
    fetchImpl: fn,
    sleep: async () => {
      slept += 1
    },
  })

  assert.equal(outcome.source, 'model')
  assert.equal(outcome.attempts, 2)
  assert.equal(slept, 1, '限流后应等待再重试')
  assert.equal(bodies.length, 2)
})

test('编排：网络超时会降级，且错误信息里不出现 API Key', async () => {
  const facts = buildRideFacts(fullRide(), [])
  const timeoutError = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  const failing = (async () => {
    throw timeoutError
  }) as unknown as typeof fetch

  const outcome = await generateCoachReview(aiConfig, facts, coachCacheKey('r1', 2), {
    fetchImpl: failing,
    sleep: noSleep,
  })

  assert.equal(outcome.source, 'fallback')
  assert.ok(outcome.fallbackReason?.includes('超时'))
  assert.ok(!outcome.fallbackReason?.includes('sk-'), '错误信息里绝不能出现密钥')
})

test('编排：每次调用都留下可观测记录（成功与失败都要）', async () => {
  const facts = buildRideFacts(fullRide(), [])
  const ok = makeFetch(() => jsonResponse(deepseekOk()))
  const bad = makeFetch(() => jsonResponse({}, 500))

  await generateCoachReview(aiConfig, facts, coachCacheKey('ok', 1), { fetchImpl: ok.fn, sleep: noSleep })
  await generateCoachReview(aiConfig, facts, coachCacheKey('bad', 1), { fetchImpl: bad.fn, sleep: noSleep })

  const stats = aiCallStats()
  assert.equal(stats.total, 2)
  assert.equal(stats.ok, 1)
  assert.equal(stats.failed, 1)
  assert.equal(stats.promptTokens, 320)
  assert.ok(stats.avgDurationMs >= 0)
})

test('编排：命中缓存不计入调用统计（它确实没有产生费用）', async () => {
  const facts = buildRideFacts(fullRide(), [])
  const key = coachCacheKey('r1', 2)
  const { fn } = makeFetch(() => jsonResponse(deepseekOk()))

  await generateCoachReview(aiConfig, facts, key, { fetchImpl: fn, sleep: noSleep })
  await generateCoachReview(aiConfig, facts, key, { fetchImpl: fn, sleep: noSleep })
  assert.equal(aiCallStats().total, 1)
})

/* ==================== 4. HTTP 集成：权限边界与未配 Key 的表现 ==================== */

let app: FastifyInstance
let db: Database
let originalFetch: typeof fetch

before(async () => {
  const config = loadConfig(
    {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-'.repeat(5),
      DATABASE_PATH: ':memory:',
      COOKIE_SECURE: 'false',
      ALLOW_REGISTER: 'true',
      AUTH_RATE_LIMIT_MAX: '1000',
      ADMIN_ACCOUNTS: 'admin-root,admin-2',
      DEEPSEEK_API_KEY: 'sk-test-not-a-real-key',
    },
    process.cwd()
  )
  db = await openDatabase(config.databasePath)
  app = await buildApp(config, db)
  await app.ready()

  // 接口层没法注入 fetch，这里替换全局的；chat() 的默认参数在调用时求值，所以生效
  originalFetch = globalThis.fetch
  globalThis.fetch = makeFetch((index) =>
    index === 0 ? jsonResponse(deepseekOk()) : jsonResponse(deepseekOk())
  ).fn
})

after(async () => {
  globalThis.fetch = originalFetch
  await app.close()
  db.close()
})

/** 账号只注册一次：同一个账号在多个用例里复用同一个会话 Cookie */
const sessions = new Map<string, string>()

async function sessionFor(email: string): Promise<string> {
  const cached = sessions.get(email)
  if (cached) return cached
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'password-123' } })
  assert.equal(res.statusCode, 201, `注册失败：${res.body}`)
  const raw = res.headers['set-cookie']
  const value = Array.isArray(raw) ? String(raw[0]) : String(raw ?? '')
  const match = value.match(/cd_session=([^;]+)/)
  assert.ok(match)
  const cookie = `cd_session=${match[1]}`
  sessions.set(email, cookie)
  return cookie
}

test('AI 接口：未登录 401', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/ai/coach', payload: { rideId: 'x' } })
  assert.equal(res.statusCode, 401)
})

test('AI 接口：普通用户 403 —— 个人备案主体不能面向公众提供 AI 服务，这条限制落在代码里', async () => {
  const cookie = await sessionFor('normal-user')
  const res = await app.inject({
    method: 'POST',
    url: '/api/ai/coach',
    payload: { rideId: 'x' },
    headers: { cookie },
  })
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error.code, 'forbidden')

  const status = await app.inject({ method: 'GET', url: '/api/ai/status', headers: { cookie } })
  assert.equal(status.statusCode, 403)
})

test('AI 接口：管理员可生成复盘，且响应里带上记录已有的规则建议供降级使用', async () => {
  const cookie = await sessionFor('admin-root')
  const saved = await app.inject({
    method: 'PUT',
    url: '/api/rides/ride-ai-1',
    payload: {
      id: 'ride-ai-1',
      date: '2026-09-28',
      distanceKm: 32.5,
      env: { temperature: 27.7, aqi: 48 },
      route: { elevationGain: 321, surface: 'asphalt' },
      track: [{ lat: 23.12, lon: 113.32 }],
      comment: '整体条件不错，适合按计划骑行。',
      suggestions: ['平均坡度较陡，注意变速节奏与爬坡补水。'],
    },
    headers: { cookie },
  })
  assert.equal(saved.statusCode, 200, saved.body)

  const status = await app.inject({ method: 'GET', url: '/api/ai/status', headers: { cookie } })
  assert.equal(status.json().available, true)
  assert.equal(status.json().model, 'deepseek-chat')

  const res = await app.inject({
    method: 'POST',
    url: '/api/ai/coach',
    payload: { rideId: 'ride-ai-1' },
    headers: { cookie },
  })
  assert.equal(res.statusCode, 200, res.body)
  const body = res.json()
  assert.equal(body.source, 'model')
  assert.ok(body.review.summary.length > 0)
  assert.ok(body.promptChars > 0)
  // 降级兜底的内容随响应一起给前端，省掉一次额外请求
  assert.equal(body.fallback.comment, '整体条件不错，适合按计划骑行。')
  assert.deepEqual(body.fallback.suggestions, ['平均坡度较陡，注意变速节奏与爬坡补水。'])
})

test('AI 接口：普通用户拿不到他人记录（在权限钩子就被拦，根本走不到查记录那一步）', async () => {
  // 先由管理员建一条记录，再确认普通用户无法通过 AI 接口读到它
  const owner = await sessionFor('admin-2')
  await app.inject({
    method: 'PUT',
    url: '/api/rides/ride-ai-2',
    payload: {
      id: 'ride-ai-2',
      date: '2026-09-27',
      distanceKm: 10,
      env: { temperature: 20 },
      route: { elevationGain: 10 },
      track: [],
    },
    headers: { cookie: owner },
  })

  const other = await sessionFor('another-user')
  const res = await app.inject({
    method: 'POST',
    url: '/api/ai/coach',
    payload: { rideId: 'ride-ai-2' },
    headers: { cookie: other },
  })
  assert.equal(res.statusCode, 403)
})

test('AI 接口：缺少 rideId 返回 400', async () => {
  const cookie = await sessionFor('admin-2')
  const res = await app.inject({ method: 'POST', url: '/api/ai/coach', payload: {}, headers: { cookie } })
  assert.equal(res.statusCode, 400, res.body)
  assert.equal(res.json().error.code, 'invalid_request')
})

test('AI 接口：未配置 DEEPSEEK_API_KEY 时返回 503 而不是崩掉，其它接口照常', async () => {
  const config = loadConfig(
    {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-'.repeat(5),
      DATABASE_PATH: ':memory:',
      COOKIE_SECURE: 'false',
      ALLOW_REGISTER: 'true',
      AUTH_RATE_LIMIT_MAX: '1000',
      ADMIN_ACCOUNTS: 'admin-nokey',
    },
    process.cwd()
  )
  const noKeyDb = await openDatabase(config.databasePath)
  const noKeyApp = await buildApp(config, noKeyDb)
  await noKeyApp.ready()

  const registerRes = await noKeyApp.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'admin-nokey', password: 'password-123' },
  })
  const raw = registerRes.headers['set-cookie']
  const value = Array.isArray(raw) ? String(raw[0]) : String(raw ?? '')
  const cookie = `cd_session=${value.match(/cd_session=([^;]+)/)![1]}`

  const status = await noKeyApp.inject({ method: 'GET', url: '/api/ai/status', headers: { cookie } })
  assert.equal(status.json().available, false)
  assert.equal(status.json().model, null)

  const res = await noKeyApp.inject({
    method: 'POST',
    url: '/api/ai/coach',
    payload: { rideId: 'whatever' },
    headers: { cookie },
  })
  assert.equal(res.statusCode, 503)
  assert.equal(res.json().error.code, 'ai_disabled')

  // 探活不受影响：AI 只是增强，不能成为整站的单点故障
  const health = await noKeyApp.inject({ method: 'GET', url: '/api/health' })
  assert.equal(health.statusCode, 200)

  await noKeyApp.close()
  noKeyDb.close()
})
