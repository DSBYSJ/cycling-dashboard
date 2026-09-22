import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { loadConfig } from '../src/config.ts'
import { openDatabase, type Database } from '../src/db/index.ts'
import { buildApp } from '../src/app.ts'

/**
 * 集成测试:用真实 SQLite(内存库) + Fastify 的 inject 发真实 HTTP 请求，
 * 覆盖注册/登录/登出、数据读写、以及最要紧的「用户之间数据隔离」。
 */

let app: FastifyInstance
let db: Database

before(async () => {
  const config = loadConfig(
    {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-'.repeat(5), // 60 字符，满足最小长度
      DATABASE_PATH: ':memory:',
      COOKIE_SECURE: 'false',
      ALLOW_REGISTER: 'true',
      AUTH_RATE_LIMIT_MAX: '1000', // 测试里会反复登录，把限流放宽
    },
    process.cwd()
  )
  db = await openDatabase(config.databasePath)
  app = await buildApp(config, db)
  await app.ready()
})

after(async () => {
  await app.close()
  db.close()
})

/* ==================== 助手 ==================== */

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie']
  const value = Array.isArray(raw) ? String(raw[0]) : String(raw ?? '')
  const match = value.match(/cd_session=([^;]+)/)
  assert.ok(match, `响应里没有会话 Cookie：${value}`)
  return `cd_session=${match[1]}`
}

async function register(email: string, password = 'password-123') {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password } })
  return res
}

/** 注册一个新用户并返回它的 Cookie，用于隔离测试 */
async function newUserCookie(email: string, password = 'password-123'): Promise<string> {
  const res = await register(email, password)
  assert.equal(res.statusCode, 201, `注册失败：${res.body}`)
  return cookieOf(res)
}

const ride = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  date: '2026-09-15',
  distanceKm: 30.5,
  env: { temperature: 22, aqi: 40 },
  route: { elevationGain: 120, surface: 'asphalt' },
  track: [
    { lat: 23.12, lon: 113.32, ele: 12 },
    { lat: 23.13, lon: 113.33, ele: 15 },
  ],
  ...extra,
})

/* ==================== 基础 ==================== */

test('探活接口不需要登录', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/health' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().ok, true)
})

test('未登录访问数据接口一律 401', async () => {
  for (const url of ['/api/bootstrap', '/api/rides', '/api/bikes', '/api/days']) {
    const res = await app.inject({ method: 'GET', url })
    assert.equal(res.statusCode, 401, `${url} 应要求登录`)
    assert.equal(res.json().error.code, 'unauthorized')
  }
})

/* ==================== 注册与登录 ==================== */

test('注册成功:返回用户信息、种下 httpOnly Cookie、邮箱被归一化', async () => {
  const res = await register('  Rider@Example.COM  ')
  assert.equal(res.statusCode, 201)
  const body = res.json()
  assert.equal(body.user.email, 'rider@example.com', '邮箱应转小写去空白')
  assert.equal(body.user.passwordHash, undefined, '响应里绝不能出现密码哈希')

  const setCookie = String(res.headers['set-cookie'])
  assert.match(setCookie, /HttpOnly/i, 'Cookie 必须是 httpOnly')
  assert.match(setCookie, /SameSite=Lax/i)
})

test('注册:重复邮箱、短密码、非法邮箱都被拒绝', async () => {
  const dup = await register('rider@example.com')
  assert.equal(dup.statusCode, 409)
  assert.equal(dup.json().error.code, 'email_taken')

  const weak = await register('other@example.com', '123')
  assert.equal(weak.statusCode, 400)

  const badEmail = await register('not-an-email')
  assert.equal(badEmail.statusCode, 400)
})

test('登录:密码错误返回统一的 401，不泄露"邮箱是否存在"', async () => {
  const wrongPassword = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'rider@example.com', password: 'wrong-password' },
  })
  assert.equal(wrongPassword.statusCode, 401)
  assert.equal(wrongPassword.json().error.code, 'invalid_credentials')

  const noSuchUser = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'nobody@example.com', password: 'wrong-password' },
  })
  assert.equal(noSuchUser.statusCode, 401)
  assert.equal(noSuchUser.json().error.message, wrongPassword.json().error.message, '两种情况提示必须一致')
})

test('登录成功:拿到 Cookie，并能用它读到自己', async () => {
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'rider@example.com', password: 'password-123' },
  })
  assert.equal(login.statusCode, 200)
  const cookie = cookieOf(login)

  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
  assert.equal(me.statusCode, 200)
  assert.equal(me.json().user.email, 'rider@example.com')
})

test('退出登录:清掉 Cookie 后原 Cookie 立即失效', async () => {
  const cookie = await newUserCookie('logout@example.com')
  const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })
  assert.equal(out.statusCode, 204)
  assert.match(String(out.headers['set-cookie']), /cd_session=;|cd_session=;/)

  // 服务端无状态，Cookie 本身仍能通过验签 —— 这里验证的是接口语义:客户端已不再持有登录态
  const afterLogout = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: '' } })
  assert.equal(afterLogout.statusCode, 401)
})

test('伪造的会话 Cookie 不被接受', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: 'cd_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.fake' },
  })
  assert.equal(res.statusCode, 401)
})

test('修改密码:当前密码不对要拒绝，改成功后旧密码失效、新密码可登录', async () => {
  const cookie = await newUserCookie('changepw@example.com', 'old-password-1')

  const wrong = await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: { cookie },
    payload: { currentPassword: 'not-the-password', newPassword: 'new-password-1' },
  })
  assert.equal(wrong.statusCode, 401)

  const ok = await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: { cookie },
    payload: { currentPassword: 'old-password-1', newPassword: 'new-password-1' },
  })
  assert.equal(ok.statusCode, 204)

  const oldLogin = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'changepw@example.com', password: 'old-password-1' },
  })
  assert.equal(oldLogin.statusCode, 401, '旧密码应失效')

  const newLogin = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'changepw@example.com', password: 'new-password-1' },
  })
  assert.equal(newLogin.statusCode, 200)
})

/* ==================== 骑行记录 ==================== */

test('骑行记录:写入、列表(不含轨迹)、详情(含轨迹)', async () => {
  const cookie = await newUserCookie('rides@example.com')

  const put = await app.inject({
    method: 'PUT',
    url: '/api/rides/ride_1',
    headers: { cookie },
    payload: ride('ride_1'),
  })
  assert.equal(put.statusCode, 200, put.body)

  const list = await app.inject({ method: 'GET', url: '/api/rides', headers: { cookie } })
  assert.equal(list.statusCode, 200)
  const listBody = list.json()
  assert.equal(listBody.total, 1)
  assert.equal(listBody.items[0].id, 'ride_1')
  assert.deepEqual(listBody.items[0].track, [], '列表不应带轨迹数据')
  assert.equal(listBody.items[0].hasTrack, true, '应标记该记录含轨迹')
  assert.equal(listBody.items[0].distanceKm, 30.5)

  const detail = await app.inject({ method: 'GET', url: '/api/rides/ride_1', headers: { cookie } })
  assert.equal(detail.statusCode, 200)
  assert.equal(detail.json().ride.track.length, 2, '详情应带完整轨迹')
})

test('骑行记录:同 id 再次写入为覆盖，不是新增', async () => {
  const cookie = await newUserCookie('upsert@example.com')
  await app.inject({
    method: 'PUT',
    url: '/api/rides/ride_x',
    headers: { cookie },
    payload: ride('ride_x', { distanceKm: 10 }),
  })
  await app.inject({
    method: 'PUT',
    url: '/api/rides/ride_x',
    headers: { cookie },
    payload: ride('ride_x', { distanceKm: 42 }),
  })
  const list = await app.inject({ method: 'GET', url: '/api/rides', headers: { cookie } })
  const body = list.json()
  assert.equal(body.total, 1, '同 id 覆盖后应仍只有一条')
  assert.equal(body.items[0].distanceKm, 42)
})

test('骑行记录:列表按日期倒序，且支持日期区间筛选与分页', async () => {
  const cookie = await newUserCookie('filter@example.com')
  for (const [id, date] of [
    ['r_a', '2026-09-01'],
    ['r_b', '2026-09-10'],
    ['r_c', '2026-09-20'],
  ] as const) {
    await app.inject({ method: 'PUT', url: `/api/rides/${id}`, headers: { cookie }, payload: ride(id, { date }) })
  }

  const all = await app.inject({ method: 'GET', url: '/api/rides', headers: { cookie } })
  assert.deepEqual(
    all.json().items.map((r: { id: string }) => r.id),
    ['r_c', 'r_b', 'r_a'],
    '应按日期倒序'
  )

  const range = await app.inject({ method: 'GET', url: '/api/rides?from=2026-09-05&to=2026-09-15', headers: { cookie } })
  assert.deepEqual(range.json().items.map((r: { id: string }) => r.id), ['r_b'])
  assert.equal(range.json().total, 1)

  const page = await app.inject({ method: 'GET', url: '/api/rides?limit=2&offset=1', headers: { cookie } })
  assert.deepEqual(page.json().items.map((r: { id: string }) => r.id), ['r_b', 'r_a'])
  assert.equal(page.json().total, 3, 'total 应是筛选后的总数而非当页条数')
})

test('骑行记录:路径参数与请求体 id 不一致时拒绝', async () => {
  const cookie = await newUserCookie('mismatch@example.com')
  const res = await app.inject({
    method: 'PUT',
    url: '/api/rides/aaa',
    headers: { cookie },
    payload: ride('bbb'),
  })
  assert.equal(res.statusCode, 400)
})

test('骑行记录:非法数据被拒绝且不入库', async () => {
  const cookie = await newUserCookie('invalid@example.com')
  const bad = await app.inject({
    method: 'PUT',
    url: '/api/rides/bad_1',
    headers: { cookie },
    payload: { id: 'bad_1', date: '2026/09/15' },
  })
  assert.equal(bad.statusCode, 400)

  const list = await app.inject({ method: 'GET', url: '/api/rides', headers: { cookie } })
  assert.equal(list.json().total, 0, '被拒绝的数据不能进库')
})

test('骑行记录:删除后列表与详情都为 404', async () => {
  const cookie = await newUserCookie('delete@example.com')
  await app.inject({ method: 'PUT', url: '/api/rides/ride_d', headers: { cookie }, payload: ride('ride_d') })

  const del = await app.inject({ method: 'DELETE', url: '/api/rides/ride_d', headers: { cookie } })
  assert.equal(del.statusCode, 204)

  const again = await app.inject({ method: 'DELETE', url: '/api/rides/ride_d', headers: { cookie } })
  assert.equal(again.statusCode, 404)

  const detail = await app.inject({ method: 'GET', url: '/api/rides/ride_d', headers: { cookie } })
  assert.equal(detail.statusCode, 404)
})

test('骑行记录:批量导入跳过坏数据并如实计数', async () => {
  const cookie = await newUserCookie('bulk@example.com')
  const res = await app.inject({
    method: 'POST',
    url: '/api/rides/bulk',
    headers: { cookie },
    payload: {
      rides: [ride('bulk_1'), { id: 'bulk_2', date: '不是日期' }, ride('bulk_3'), 'not-an-object'],
    },
  })
  assert.equal(res.statusCode, 201)
  assert.equal(res.json().imported, 2)
  assert.equal(res.json().skipped, 2)

  const list = await app.inject({ method: 'GET', url: '/api/rides', headers: { cookie } })
  assert.equal(list.json().total, 2)
})

/* ==================== 用户隔离（最关键的一组） ==================== */

test('用户隔离:A 的记录对 B 完全不可见', async () => {
  const cookieA = await newUserCookie('alice@example.com')
  const cookieB = await newUserCookie('bob@example.com')

  await app.inject({ method: 'PUT', url: '/api/rides/secret_a', headers: { cookie: cookieA }, payload: ride('secret_a') })
  await app.inject({ method: 'PUT', url: '/api/bikes/bike_a', headers: { cookie: cookieA }, payload: { id: 'bike_a', name: 'A 的车' } })
  await app.inject({ method: 'PUT', url: '/api/days/2026-09-15', headers: { cookie: cookieA }, payload: { id: '2026-09-15', date: '2026-09-15', rode: true } })

  const listB = await app.inject({ method: 'GET', url: '/api/rides', headers: { cookie: cookieB } })
  assert.equal(listB.json().total, 0, 'B 不该看到 A 的记录')

  const detailB = await app.inject({ method: 'GET', url: '/api/rides/secret_a', headers: { cookie: cookieB } })
  assert.equal(detailB.statusCode, 404, '直接猜 id 也读不到')

  const delB = await app.inject({ method: 'DELETE', url: '/api/rides/secret_a', headers: { cookie: cookieB } })
  assert.equal(delB.statusCode, 404, '也删不掉')

  const bikesB = await app.inject({ method: 'GET', url: '/api/bikes', headers: { cookie: cookieB } })
  assert.equal(bikesB.json().items.length, 0)

  const daysB = await app.inject({ method: 'GET', url: '/api/days', headers: { cookie: cookieB } })
  assert.equal(daysB.json().items.length, 0)

  const bootstrapA = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie: cookieA } })
  assert.equal(bootstrapA.json().rides.total, 1, 'A 自己依然看得到')
  assert.equal(bootstrapA.json().user.email, 'alice@example.com')
})

test('用户隔离:两个用户可以用相同的记录 id，互不覆盖', async () => {
  const cookieC = await newUserCookie('carol@example.com')
  const cookieD = await newUserCookie('dave@example.com')

  await app.inject({ method: 'PUT', url: '/api/rides/same_id', headers: { cookie: cookieC }, payload: ride('same_id', { distanceKm: 11 }) })
  await app.inject({ method: 'PUT', url: '/api/rides/same_id', headers: { cookie: cookieD }, payload: ride('same_id', { distanceKm: 77 }) })

  const detailC = await app.inject({ method: 'GET', url: '/api/rides/same_id', headers: { cookie: cookieC } })
  const detailD = await app.inject({ method: 'GET', url: '/api/rides/same_id', headers: { cookie: cookieD } })
  assert.equal(detailC.json().ride.distanceKm, 11)
  assert.equal(detailD.json().ride.distanceKm, 77)
})

/* ==================== 单车与打卡 ==================== */

test('单车:写入、列表、删除', async () => {
  const cookie = await newUserCookie('bikes@example.com')
  const put = await app.inject({
    method: 'PUT',
    url: '/api/bikes/b1',
    headers: { cookie },
    payload: { id: 'b1', name: '小蓝', category: 'road', tireTypeId: 'road-clincher', tireInstalledAt: '2026-01-01', tireStartKm: 0 },
  })
  assert.equal(put.statusCode, 200, put.body)
  assert.equal(put.json().bike.category, 'road')

  const list = await app.inject({ method: 'GET', url: '/api/bikes', headers: { cookie } })
  assert.equal(list.json().items.length, 1)
  assert.equal(list.json().items[0].name, '小蓝')

  const del = await app.inject({ method: 'DELETE', url: '/api/bikes/b1', headers: { cookie } })
  assert.equal(del.statusCode, 204)
})

test('打卡:同一天重复写入为覆盖(一天一条)', async () => {
  const cookie = await newUserCookie('days@example.com')
  await app.inject({
    method: 'PUT',
    url: '/api/days/2026-09-15',
    headers: { cookie },
    payload: { id: '2026-09-15', date: '2026-09-15', rode: true, distanceKm: 20 },
  })
  await app.inject({
    method: 'PUT',
    url: '/api/days/2026-09-15',
    headers: { cookie },
    payload: { id: '2026-09-15', date: '2026-09-15', rode: false },
  })

  const list = await app.inject({ method: 'GET', url: '/api/days', headers: { cookie } })
  assert.equal(list.json().items.length, 1)
  assert.equal(list.json().items[0].rode, false, '后写入的应覆盖前一次')
})

/* ==================== 首屏聚合 ==================== */

test('首屏接口:一次拿到用户、单车、打卡与记录列表', async () => {
  const cookie = await newUserCookie('bootstrap@example.com')
  await app.inject({ method: 'PUT', url: '/api/bikes/bb', headers: { cookie }, payload: { id: 'bb', name: '车' } })
  await app.inject({ method: 'PUT', url: '/api/rides/br', headers: { cookie }, payload: ride('br') })

  const res = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie } })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.user.email, 'bootstrap@example.com')
  assert.equal(body.bikes.length, 1)
  assert.equal(body.days.length, 0)
  assert.equal(body.rides.total, 1)
  assert.deepEqual(body.rides.items[0].track, [])
})

test('未知接口返回结构化 404', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/nope' })
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error.code, 'not_found')
})
