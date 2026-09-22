import jwt from 'jsonwebtoken'

/** 登录态载荷:只放不可变的身份信息，其余每次请求从库里取，保证改名/改密后立即生效 */
export interface SessionPayload {
  userId: number
  email: string
}

const ISSUER = 'cycling-dashboard'

export function signSession(userId: number, email: string, secret: string, days: number): string {
  return jwt.sign({ email }, secret, {
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
    return { userId, email: typeof decoded.email === 'string' ? decoded.email : '' }
  } catch {
    return null
  }
}
