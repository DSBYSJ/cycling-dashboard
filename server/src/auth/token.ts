import jwt from 'jsonwebtoken'

/**
 * 登录态载荷:只放不可变的身份信息 + 令牌版本，其余每次请求从库里取
 * (所以改状态、停用能立即生效)。
 */
export interface SessionPayload {
  userId: number
  email: string
  /** 令牌版本:改密 / 重置密码 / 停用后自增，使此前签发的令牌立即失效 */
  tokenVersion: number
}

const ISSUER = 'cycling-dashboard'

export function signSession(
  userId: number,
  email: string,
  tokenVersion: number,
  secret: string,
  days: number
): string {
  return jwt.sign({ email, tv: tokenVersion }, secret, {
    subject: String(userId),
    expiresIn: `${days}d`,
    issuer: ISSUER,
  })
}

/** 校验并解析会话令牌;签名不对、过期、结构异常一律返回 null(调用方按"未登录"处理) */
export function verifySession(token: string, secret: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, secret, { issuer: ISSUER })
    if (typeof decoded === 'string' || !decoded.sub) return null
    const userId = Number(decoded.sub)
    if (!Number.isInteger(userId) || userId <= 0) return null
    return {
      userId,
      email: typeof decoded.email === 'string' ? decoded.email : '',
      // 早于本次升级签发的令牌没有 tv，按 0 处理(与数据库默认值一致 → 不会被误踢)
      tokenVersion: typeof decoded.tv === 'number' && Number.isInteger(decoded.tv) ? decoded.tv : 0,
    }
  } catch {
    return null
  }
}
