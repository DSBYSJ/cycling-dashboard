import test from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { hashPassword, verifyPassword, PASSWORD_MIN_LENGTH } from '../src/auth/password.ts'
import { signSession, verifySession } from '../src/auth/token.ts'
import {
  normalizeAccount,
  parsePagination,
  validateBike,
  validateDay,
  validatePassword,
  validateRide,
} from '../src/lib/validate.ts'

/* ==================== 密码哈希 ==================== */

test('密码哈希:同一密码每次盐不同，但都能校验通过', async () => {
  const a = await hashPassword('correct horse battery')
  const b = await hashPassword('correct horse battery')
  assert.notEqual(a, b, '两次哈希不应相同(盐随机)')
  assert.ok(a.startsWith('scrypt$'))
  assert.equal(await verifyPassword('correct horse battery', a), true)
  assert.equal(await verifyPassword('correct horse battery', b), true)
})

test('密码哈希:错误密码与损坏的存储值都返回 false，且不抛错', async () => {
  const stored = await hashPassword('s3cret-password')
  assert.equal(await verifyPassword('s3cret-passwore', stored), false)
  assert.equal(await verifyPassword('', stored), false)
  assert.equal(await verifyPassword('x', 'not-a-valid-hash'), false)
  assert.equal(await verifyPassword('x', 'scrypt$@@@$###'), false)
  assert.equal(await verifyPassword('x', 'scrypt$c2FsdA==$'), false)
})

/* ==================== 会话令牌 ==================== */

test('会话令牌:签发后能验回同一身份', () => {
  const secret = 'a'.repeat(48)
  const token = signSession(42, 'a@b.com', 0, secret, 30)
  const session = verifySession(token, secret)
  assert.deepEqual(session, { userId: 42, email: 'a@b.com', tokenVersion: 0 })
})

test('会话令牌:令牌版本会被带回来(改密/停用后据此让旧令牌失效)', () => {
  const secret = 'a'.repeat(48)
  const token = signSession(7, 'a@b.com', 3, secret, 30)
  assert.equal(verifySession(token, secret)?.tokenVersion, 3, '版本应原样带回')
})

test('会话令牌:早于本次升级签发的令牌按版本 0 处理(不会被误踢下线)', () => {
  const secret = 'a'.repeat(48)
  // 模拟老令牌:没有 tv 字段
  const legacy = jwt.sign({ email: 'a@b.com' }, secret, {
    subject: '9',
    expiresIn: '1d',
    issuer: 'cycling-dashboard',
  })
  assert.equal(verifySession(legacy, secret)?.tokenVersion, 0)
})

test('会话令牌:换密钥、被篡改、已过期都必须验不过', () => {
  const secret = 'a'.repeat(48)
  const token = signSession(1, 'a@b.com', 0, secret, 30)

  assert.equal(verifySession(token, 'b'.repeat(48)), null, '换密钥应验不过')

  const parts = token.split('.')
  const tampered = `${parts[0]}.${Buffer.from(JSON.stringify({ sub: '999', iss: 'cycling-dashboard' })).toString('base64url')}.${parts[2]}`
  assert.equal(verifySession(tampered, secret), null, '改载荷应验不过')

  const expired = jwt.sign({ email: 'a@b.com' }, secret, {
    subject: '1',
    expiresIn: '-1s',
    issuer: 'cycling-dashboard',
  })
  assert.equal(verifySession(expired, secret), null, '过期应验不过')

  assert.equal(verifySession('garbage', secret), null)
})

test('会话令牌:签发方不是本服务的一律拒绝', () => {
  const secret = 'a'.repeat(48)
  const foreign = jwt.sign({}, secret, { subject: '1', expiresIn: '1d', issuer: 'someone-else' })
  assert.equal(verifySession(foreign, secret), null)
})

/* ==================== 账号标识与密码 ==================== */

test('账号归一化:去空白并转小写', () => {
  assert.equal(normalizeAccount('  Rider@Example.COM '), 'rider@example.com')
  assert.equal(normalizeAccount('  Admin '), 'admin', '纯用户名同样要归一化')
})

test('账号校验:带 @ 走邮箱规则,不带 @ 走用户名规则', () => {
  // 不带 @ → 用户名:字母/数字开头，只含字母数字下划线连字符，3–30 位
  assert.equal(normalizeAccount('admin'), 'admin')
  assert.equal(normalizeAccount('rider_01'), 'rider_01')
  for (const bad of ['', 'ab', 'a b', 'admin@', '-admin', 'a'.repeat(31)]) {
    assert.throws(() => normalizeAccount(bad), /邮箱或用户名/, `应拒绝：${String(bad)}`)
  }

  // 带 @ → 走邮箱规则
  for (const bad of ['a@b', 'a b@c.com', '@b.com', 'a@.com']) {
    assert.throws(() => normalizeAccount(bad), /邮箱或用户名/, `应拒绝：${String(bad)}`)
  }

  // 非字符串 → 直接提示「请输入账号」
  for (const bad of [123, null, undefined, {}]) {
    assert.throws(() => normalizeAccount(bad), /请输入账号/, `应拒绝：${String(bad)}`)
  }
})

test('密码校验:长度不足或超长都拒绝', () => {
  // 下限是 6（运营者要求放宽，见 auth/password.ts 的说明）
  assert.throws(() => validatePassword('12345'), /至少/, '5 位应被拒')
  assert.equal(validatePassword('abc123'), 'abc123', '6 位是当前下限')
  assert.equal(validatePassword('a'.repeat(PASSWORD_MIN_LENGTH)), 'a'.repeat(PASSWORD_MIN_LENGTH))
  assert.throws(() => validatePassword('a'.repeat(201)), /最长/)
  assert.throws(() => validatePassword(undefined), /请输入密码/)
})

/* ==================== 骑行记录校验 ==================== */

const minimalRide = { id: 'ride_1', date: '2026-09-15' }

test('骑行记录:最小合法输入通过，缺失字段归一到默认值', () => {
  const ride = validateRide(minimalRide)
  assert.equal(ride.id, 'ride_1')
  assert.equal(ride.date, '2026-09-15')
  assert.equal(ride.distanceKm, null)
  assert.deepEqual(ride.track, [])
  assert.deepEqual(ride.speedSeries, [])
  assert.equal(ride.scores, null)
  assert.equal(ride.env.temperature, null)
  assert.equal(ride.route.surface, null)
  assert.equal(typeof ride.createdAt, 'number')
})

test('骑行记录:id 非法或日期格式不对直接拒绝', () => {
  assert.throws(() => validateRide({ date: '2026-09-15' }), /缺少 id/)
  assert.throws(() => validateRide({ id: 'has space', date: '2026-09-15' }), /只能包含/)
  assert.throws(() => validateRide({ id: 'r1', date: '2026/09/15' }), /YYYY-MM-DD/)
  assert.throws(() => validateRide({ id: 'r1', date: '2026-9-15' }), /YYYY-MM-DD/)
  assert.throws(() => validateRide('not-an-object'), /必须是一个对象/)
})

test('骑行记录:数值越界被拒绝，避免脏数据进库', () => {
  assert.throws(() => validateRide({ ...minimalRide, distanceKm: 999_999 }), /范围/)
  assert.throws(() => validateRide({ ...minimalRide, avgSpeed: -5 }), /范围/)
  assert.throws(() => validateRide({ ...minimalRide, env: { temperature: 999 } }), /气温/)
})

test('骑行记录:轨迹点逐点校验，坐标越界与非对象被剔除', () => {
  const ride = validateRide({
    ...minimalRide,
    track: [
      { lat: 23.12, lon: 113.32, ele: 12, time: '2026-09-15T08:00:00Z' },
      { lat: 999, lon: 113.3 }, // 纬度越界 → 剔除
      null,
      { lat: 23.13, lon: 113.33 },
    ],
  })
  assert.equal(ride.track.length, 2)
  assert.deepEqual(ride.track[0], { lat: 23.12, lon: 113.32, ele: 12, time: '2026-09-15T08:00:00Z' })
  assert.equal(ride.track[1].ele, undefined)
})

test('骑行记录:track 不是数组要报错，而不是静默当成空', () => {
  assert.throws(() => validateRide({ ...minimalRide, track: 'oops' }), /track 必须是数组/)
  assert.throws(() => validateRide({ ...minimalRide, speedSeries: {} }), /speedSeries 必须是数组/)
})

test('骑行记录:评分缺字段时整体作废，避免半截评分进图表', () => {
  assert.equal(validateRide({ ...minimalRide, scores: { total: 80 } }).scores, null)
  assert.deepEqual(validateRide({ ...minimalRide, scores: { total: 80, weather: 90, route: 70 } }).scores, {
    total: 80,
    weather: 90,
    route: 70,
    rainFactor: 0,
  })
})

test('骑行记录:枚举值非法回落 null，合法值保留', () => {
  const ride = validateRide({
    ...minimalRide,
    route: { elevationGain: 100, avgGrade: 2, surface: '火箭路', traffic: 'medium' },
  })
  assert.equal(ride.route.surface, null)
  assert.equal(ride.route.traffic, 'medium')
})

test('骑行记录:建议列表只保留字符串并截断长度', () => {
  const ride = validateRide({ ...minimalRide, suggestions: ['正常', 42, null, 'x'.repeat(900)] })
  assert.equal(ride.suggestions.length, 2)
  assert.equal(ride.suggestions[0], '正常')
  assert.equal(ride.suggestions[1].length, 500)
})

/* ==================== 单车与打卡 ==================== */

test('单车:未知类别与外胎类型回落默认值', () => {
  const bike = validateBike({ id: 'b1', name: '小蓝', category: '飞机', tireTypeId: 'nope', tireInstalledAt: 'bad' })
  assert.equal(bike.category, 'other')
  assert.equal(bike.tireTypeId, 'road-race')
  assert.match(bike.tireInstalledAt, /^\d{4}-\d{2}-\d{2}$/)
})

test('单车:缺名称或 id 非法要报错', () => {
  assert.throws(() => validateBike({ id: 'b1' }), /单车名称/)
  assert.throws(() => validateBike({ name: '小蓝' }), /缺少 id/)
})

test('打卡:缺 id 时用日期兜底，rode 非布尔按 false', () => {
  const day = validateDay({ date: '2026-09-15', rode: 'yes' })
  assert.equal(day.id, '2026-09-15')
  assert.equal(day.rode, false)
  assert.throws(() => validateDay({ date: 'bad' }), /YYYY-MM-DD/)
})

/* ==================== 分页 ==================== */

test('分页参数:默认值、上限与负数处理', () => {
  assert.deepEqual(parsePagination(undefined), { limit: 200, offset: 0 })
  assert.deepEqual(parsePagination({ limit: '50', offset: '10' }), { limit: 50, offset: 10 })
  assert.equal(parsePagination({ limit: 9999 }).limit, 500, 'limit 要封顶')
  assert.deepEqual(parsePagination({ limit: 0, offset: -5 }), { limit: 1, offset: 0 })
  assert.equal(parsePagination({ limit: 'abc' }).limit, 200, '非法值回落默认而不是报错')
})
