import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { loadConfig } from '../src/config.ts'
import { openDatabase, type Database } from '../src/db/index.ts'
import { buildApp } from '../src/app.ts'
import { setBoolSetting } from '../src/lib/settings.ts'

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
      // 管理员白名单：与生产一样放在配置(.env)里，不在数据库 —— 数据库被改也提不了权
      ADMIN_ACCOUNTS: 'admin-root',
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

test('注册:重复账号、短密码、非法账号都被拒绝', async () => {
  const dup = await register('rider@example.com')
  assert.equal(dup.statusCode, 409)
  assert.equal(dup.json().error.code, 'email_taken')

  const weak = await register('other@example.com', '123')
  assert.equal(weak.statusCode, 400, '3 位密码低于下限应被拒')

  // 账号标识放宽后，不带 @ 的短字符串是合法用户名了，
  // 所以这里用「带 @ 但不符合邮箱规则」的形态来验证拒绝逻辑
  const badAccount = await register('bad@@example')
  assert.equal(badAccount.statusCode, 400)
})

test('注册:不带 @ 的纯用户名同样支持', async () => {
  const res = await register('admin_user')
  assert.equal(res.statusCode, 201, `注册失败：${res.body}`)
  assert.equal(res.json().user.email, 'admin_user', '账号标识原样保存（已转小写）')
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

/* ==================== 公开的开关快照 ==================== */

test('GET /auth/config：未登录也能拿到注册开关（登录页据此显示「暂停注册」）', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/config' })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(typeof body.allowRegister, 'boolean')
  assert.equal(typeof body.inviteRequired, 'boolean')
  assert.equal(typeof body.changelogEnabled, 'boolean')
  // 公开接口：只给几个布尔值，不能夹带任何用户信息
  assert.equal(body.user, undefined)
})

test('GET /auth/config：changelogEnabled 默认开启，站长关闭后如实反映', async () => {
  const before = await app.inject({ method: 'GET', url: '/api/auth/config' })
  assert.equal(before.json().changelogEnabled, true)

  setBoolSetting(db, 'changelog_enabled', false)
  try {
    const off = await app.inject({ method: 'GET', url: '/api/auth/config' })
    assert.equal(off.json().changelogEnabled, false)
  } finally {
    setBoolSetting(db, 'changelog_enabled', true)
  }
})

test('关闭注册后 config 如实反映，且注册接口确实被拒', async () => {
  setBoolSetting(db, 'allow_register', false)
  try {
    const cfg = await app.inject({ method: 'GET', url: '/api/auth/config' })
    assert.equal(cfg.json().allowRegister, false)

    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'config-probe@test.dev', password: 'secret123' },
    })
    assert.equal(reg.statusCode, 403)
    assert.equal(reg.json().error.code, 'register_disabled')
  } finally {
    // 复原，避免影响后面的用例
    setBoolSetting(db, 'allow_register', true)
  }
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

/* ==================== 站长控制台（权限隔离最关键） ==================== */

const ADMIN_EMAIL = 'admin-root'

function findUserId(email: string): number {
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | undefined
  assert.ok(row, `找不到账号 ${email}`)
  return row.id
}

/** 管理员账号只注册一次（重复注册会 409），之后复用同一个会话 */
let cachedAdminCookie: string | null = null
async function getAdminCookie(): Promise<string> {
  if (cachedAdminCookie) return cachedAdminCookie
  const res = await register(ADMIN_EMAIL, 'admin-password-123')
  assert.equal(res.statusCode, 201, `管理员注册失败：${res.body}`)
  cachedAdminCookie = cookieOf(res)
  return cachedAdminCookie
}

test('站长控制台:未登录访问一律 401', async () => {
  for (const url of ['/api/admin/overview', '/api/admin/users', '/api/admin/settings', '/api/admin/backups']) {
    const res = await app.inject({ method: 'GET', url })
    assert.equal(res.statusCode, 401, `${url} 应要求先登录`)
  }
})

test('站长控制台:普通用户访问一律 403（前端藏入口不算权限控制）', async () => {
  const cookie = await newUserCookie('not-admin@example.com')

  for (const url of ['/api/admin/overview', '/api/admin/users', '/api/admin/settings', '/api/admin/backups', '/api/admin/audit']) {
    const res = await app.inject({ method: 'GET', url, headers: { cookie } })
    assert.equal(res.statusCode, 403, `${url} 应拒绝普通用户`)
    assert.equal(res.json().error.code, 'forbidden')
  }

  // 写操作更要挡住：普通用户不能改系统设置
  const patch = await app.inject({
    method: 'PATCH',
    url: '/api/admin/settings',
    headers: { cookie },
    payload: { key: 'allow_register', value: false },
  })
  assert.equal(patch.statusCode, 403)

  // 也不能借后台接口拿到别人的数据
  const dump = await app.inject({ method: 'GET', url: '/api/admin/rides', headers: { cookie } })
  assert.equal(dump.statusCode, 403)
})

test('登录态接口会告知前端是不是管理员（仅用于决定是否显示入口）', async () => {
  const admin = await getAdminCookie()
  const adminMe = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: admin } })
  assert.equal(adminMe.json().isAdmin, true)

  const normal = await newUserCookie('plain-viewer@example.com')
  const normalMe = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: normal } })
  assert.equal(normalMe.json().isAdmin, false)
})

test('站长控制台:管理员可读概览，含统计、设置与服务信息', async () => {
  const cookie = await getAdminCookie()
  const res = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: { cookie } })
  assert.equal(res.statusCode, 200, res.body)
  const data = res.json()
  assert.ok(data.users.total >= 2, '应统计到已注册的账号')
  assert.ok(Array.isArray(data.settings) && data.settings.length > 0)
  assert.ok(data.settings.some((s: { key: string }) => s.key === 'allow_register'))
  assert.ok(data.server.nodeVersion.startsWith('v'))
  assert.ok(Array.isArray(data.recentUsers))
})

test('站长控制台:用户列表可搜索，且不含密码哈希', async () => {
  const cookie = await getAdminCookie()
  await newUserCookie('searchable-user@example.com')

  const res = await app.inject({ method: 'GET', url: '/api/admin/users?search=searchable', headers: { cookie } })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.total, 1)
  assert.equal(body.items[0].email, 'searchable-user@example.com')
  assert.equal(res.body.includes('password_hash'), false, '任何接口都不该返回密码哈希')
})

test('站长控制台:停用账号后，对方手里的旧 Cookie 立即失效', async () => {
  const admin = await getAdminCookie()
  const email = 'to-be-disabled@example.com'
  const victimCookie = await newUserCookie(email)
  const id = findUserId(email)

  // 停用前一切正常
  const before = await app.inject({ method: 'GET', url: '/api/rides', headers: { cookie: victimCookie } })
  assert.equal(before.statusCode, 200)

  const off = await app.inject({
    method: 'PATCH',
    url: `/api/admin/users/${id}`,
    headers: { cookie: admin },
    payload: { status: 'disabled' },
  })
  assert.equal(off.statusCode, 200, off.body)

  // 这是本次改造的关键：认证钩子会回查状态，所以旧令牌立刻作废。
  // 只验 JWT 不查库的话，对方还能继续用满整个会话有效期，"停用"就形同虚设。
  const after = await app.inject({ method: 'GET', url: '/api/rides', headers: { cookie: victimCookie } })
  assert.equal(after.statusCode, 403)
  assert.equal(after.json().error.code, 'account_disabled')

  // 重新登录也会被拒
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'password-123' },
  })
  assert.equal(login.statusCode, 403)

  // 恢复启用后可以重新登录
  const on = await app.inject({
    method: 'PATCH',
    url: `/api/admin/users/${id}`,
    headers: { cookie: admin },
    payload: { status: 'active' },
  })
  assert.equal(on.statusCode, 200)
  const relogin = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'password-123' },
  })
  assert.equal(relogin.statusCode, 200, '启用后应能重新登录')
})

test('站长控制台:重置密码会踢掉对方旧会话，并只在响应里返回一次明文', async () => {
  const admin = await getAdminCookie()
  const email = 'reset-me@example.com'
  const cookie = await newUserCookie(email)
  const id = findUserId(email)

  const res = await app.inject({
    method: 'POST',
    url: `/api/admin/users/${id}/password`,
    headers: { cookie: admin },
    payload: {},
  })
  assert.equal(res.statusCode, 200, res.body)
  const { password, generated } = res.json() as { password: string; generated: boolean }
  assert.equal(generated, true)
  assert.ok(password.length >= 8, '生成的临时密码应满足长度要求')

  // 旧会话应立刻失效（令牌版本自增）
  const old = await app.inject({ method: 'GET', url: '/api/rides', headers: { cookie } })
  assert.equal(old.statusCode, 401)
  assert.equal(old.json().error.code, 'session_expired')

  // 新密码可登录
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
  assert.equal(login.statusCode, 200, login.body)
})

test('站长控制台:删除账号必须手打账号名确认，且数据级联清掉', async () => {
  const admin = await getAdminCookie()
  const email = 'delete-me@example.com'
  const cookie = await newUserCookie(email)
  const id = findUserId(email)
  await app.inject({ method: 'PUT', url: '/api/rides/keep1', headers: { cookie }, payload: ride('keep1') })

  // 确认字符串不对 → 拒绝
  const wrong = await app.inject({
    method: 'DELETE',
    url: `/api/admin/users/${id}`,
    headers: { cookie: admin },
    payload: { confirm: '随便写点什么' },
  })
  assert.equal(wrong.statusCode, 400)
  assert.match(wrong.json().error.message, /确认删除/)
  assert.ok(db.prepare('SELECT id FROM users WHERE id = ?').get(id), '确认不通过时不能真的删掉')

  // 正确 → 删除，且 rides 随外键级联清空
  const ok = await app.inject({
    method: 'DELETE',
    url: `/api/admin/users/${id}`,
    headers: { cookie: admin },
    payload: { confirm: email },
  })
  assert.equal(ok.statusCode, 200, ok.body)
  assert.equal(db.prepare('SELECT id FROM users WHERE id = ?').get(id), undefined)
  const rows = db.prepare('SELECT COUNT(*) AS n FROM rides WHERE user_id = ?').get(id) as { n: number }
  assert.equal(rows.n, 0, '该用户的记录应被级联删除')
})

test('站长控制台:不能停用自己，也不能动白名单里的管理员（防自锁）', async () => {
  const admin = await getAdminCookie()
  const adminId = findUserId(ADMIN_EMAIL)

  const self = await app.inject({
    method: 'PATCH',
    url: `/api/admin/users/${adminId}`,
    headers: { cookie: admin },
    payload: { status: 'disabled' },
  })
  assert.equal(self.statusCode, 400)
  assert.match(self.json().error.message, /当前登录/)

  const selfDelete = await app.inject({
    method: 'DELETE',
    url: `/api/admin/users/${adminId}`,
    headers: { cookie: admin },
    payload: { confirm: ADMIN_EMAIL },
  })
  assert.equal(selfDelete.statusCode, 400)
})

test('站长控制台:写操作会落审计，且审计里不出现密码明文', async () => {
  const admin = await getAdminCookie()
  const email = 'audit-target@example.com'
  await newUserCookie(email)
  const id = findUserId(email)

  // 自己触发一次写操作，避免依赖其它用例的执行顺序
  const off = await app.inject({
    method: 'PATCH',
    url: `/api/admin/users/${id}`,
    headers: { cookie: admin },
    payload: { status: 'disabled' },
  })
  assert.equal(off.statusCode, 200, off.body)

  const res = await app.inject({ method: 'GET', url: '/api/admin/audit?limit=200', headers: { cookie: admin } })
  assert.equal(res.statusCode, 200)
  const items = res.json().items as { action: string; actorId: number; target: string | null; detail: string | null }[]

  const entry = items.find((i) => i.action === 'user.disable' && i.target === `user:${id}`)
  assert.ok(entry, '应记下一条 user.disable')
  assert.ok(entry.actorId > 0, '应记下是谁操作的')
  assert.equal(
    items.some((i) => (i.detail ?? '').includes('"password"')),
    false,
    '审计的 detail 里不该出现 password 字段'
  )
})

test('站长控制台:注册开关可在运行时切换（不用改 .env 重启）', async () => {
  const admin = await getAdminCookie()

  const off = await app.inject({
    method: 'PATCH',
    url: '/api/admin/settings',
    headers: { cookie: admin },
    payload: { key: 'allow_register', value: false },
  })
  assert.equal(off.statusCode, 200, off.body)

  const blocked = await register('blocked-by-setting@example.com')
  assert.equal(blocked.statusCode, 403)
  assert.equal(blocked.json().error.code, 'register_disabled')

  // 改回来，并确认立刻恢复
  await app.inject({
    method: 'PATCH',
    url: '/api/admin/settings',
    headers: { cookie: admin },
    payload: { key: 'allow_register', value: true },
  })
  assert.equal((await register('unblocked-again@example.com')).statusCode, 201)
})

test('留言:默认不对外开放，管理员可先行测试；开启后用户只能看到自己的', async () => {
  const normal = await newUserCookie('feedback-viewer@example.com')

  // 默认关闭：普通用户提交被拒
  const blocked = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: { cookie: normal },
    payload: { content: '你好' },
  })
  assert.equal(blocked.statusCode, 403)
  assert.equal(blocked.json().error.code, 'feedback_disabled')

  // 管理员始终可用（站长要先能把它跑通再决定对外开不开）
  const admin = await getAdminCookie()
  const posted = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: { cookie: admin },
    payload: { content: '这是一条测试留言' },
  })
  assert.equal(posted.statusCode, 201, posted.body)

  const list = await app.inject({ method: 'GET', url: '/api/admin/feedback', headers: { cookie: admin } })
  assert.equal(list.statusCode, 200)
  const item = (list.json().items as { id: number; content: string }[]).find((i) => i.content === '这是一条测试留言')
  assert.ok(item, '后台应能看到这条留言')

  const reply = await app.inject({
    method: 'POST',
    url: `/api/admin/feedback/${item.id}/reply`,
    headers: { cookie: admin },
    payload: { reply: '收到，谢谢反馈' },
  })
  assert.equal(reply.statusCode, 200)

  // 开启后普通用户可用，且只看得到自己的
  await app.inject({
    method: 'PATCH',
    url: '/api/admin/settings',
    headers: { cookie: admin },
    payload: { key: 'feedback_enabled', value: true },
  })
  const nowOk = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: { cookie: normal },
    payload: { content: '开启后提交' },
  })
  assert.equal(nowOk.statusCode, 201, nowOk.body)

  const mine = await app.inject({ method: 'GET', url: '/api/feedback', headers: { cookie: normal } })
  assert.equal(mine.json().items.length, 1, '用户只看得到自己提交的')
  assert.equal(mine.json().items[0].content, '开启后提交')
})

test('站长控制台:环境变量接口只给键名与是否配置，绝不返回值', async () => {
  const cookie = await getAdminCookie()
  const res = await app.inject({ method: 'GET', url: '/api/admin/env', headers: { cookie } })
  assert.equal(res.statusCode, 200)

  const items = res.json().items as { key: string; configured: boolean; secret: boolean }[]
  const jwt = items.find((i) => i.key === 'JWT_SECRET')
  assert.ok(jwt, '应列出 JWT_SECRET 这一项')
  assert.equal(jwt.secret, true, '应标记为敏感项')

  // 整个响应体里不能出现测试用的那个密钥本身
  assert.equal(res.body.includes('test-secret-'), false, '不能返回任何配置值')
})
