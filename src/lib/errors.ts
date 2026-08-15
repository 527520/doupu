/** 应用错误（spec §4.2 错误约定）。 */

export type AppErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'MAIL_UNAVAILABLE'
  | 'INTERNAL';

export const HTTP_STATUS: Record<AppErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  MAIL_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** 携带可安全返回给前端的错误码与字段路径；绝不包含堆栈/内部细节。 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /** zod 字段路径或业务字段名，用于 UI 定位。 */
  readonly field?: string;

  constructor(code: AppErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.field = field;
  }
}

/** API 统一错误响应体。 */
export interface ApiErrorBody {
  error: { code: AppErrorCode; message: string; field?: string };
}
