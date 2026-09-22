import crypto from 'node:crypto'

/**
 * 密码哈希:用 Node 内置的 scrypt，不引入 bcrypt(原生模块，便宜服务器上经常编译失败)。
 * 存储格式: scrypt$<salt base64>$<hash base64>，自带算法标识，将来换算法也能兼容旧记录。
 */

const KEY_LENGTH = 64
const SALT_BYTES = 16
const ALGORITHM = 'scrypt'

/** 密码长度上限:scrypt 的耗时随输入增长，加个上限避免被人用超长密码拖垮 CPU */
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 200

function derive(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES)
  const derived = await derive(password, salt, KEY_LENGTH)
  return `${ALGORITHM}$${salt.toString('base64')}$${derived.toString('base64')}`
}

/** 校验密码。任何格式异常都返回 false(不抛错)，避免把内部细节暴露给调用方 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== ALGORITHM) return false
  try {
    const salt = Buffer.from(parts[1], 'base64')
    const expected = Buffer.from(parts[2], 'base64')
    if (salt.length === 0 || expected.length === 0) return false
    const derived = await derive(password, salt, expected.length)
    // 定长比较，避免通过响应时间推断密码是否正确
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}
