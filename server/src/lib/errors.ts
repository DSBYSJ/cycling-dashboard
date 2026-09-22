/** 业务错误:带 HTTP 状态码，由统一错误处理器转成响应体 */
export class AppError extends Error {
  statusCode: number
  /** 给前端看的稳定错误码，便于前端按码处理(如 session_expired) */
  code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
  }
}

export const badRequest = (message: string, code = 'invalid_request') => new AppError(400, code, message)
export const unauthorized = (message = '未登录或登录已过期', code = 'unauthorized') =>
  new AppError(401, code, message)
export const forbidden = (message = '没有权限', code = 'forbidden') => new AppError(403, code, message)
export const notFound = (message = '资源不存在', code = 'not_found') => new AppError(404, code, message)
export const tooManyRequests = (message = '操作过于频繁，请稍后再试', code = 'rate_limited') =>
  new AppError(429, code, message)
