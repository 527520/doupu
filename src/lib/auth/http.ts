/**
 * API 响应工具：JSON 解析、统一错误体（spec §4.2），绝不泄露内部细节。
 */
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError, type ApiErrorBody } from '@/lib/errors';
import { zodErrorsToStrings } from '@/lib/schemas';
import { config } from '@/lib/config';

export type JsonResult = { ok: true; data: unknown } | { ok: false; response: NextResponse };

/** 认证类端点默认上限（票 02 配置化：环境变量 MAX_BODY_BYTES）。 */
export const DEFAULT_MAX_BODY_BYTES = config.security.maxBodyBytes;

/**
 * 解析 JSON 请求体；失败返回 400 VALIDATION。
 * maxBytes 先按 Content-Length 预检、再流式截断，避免超大 body 打爆内存（安全审查 P0）。
 */
export async function readJson(request: Request, maxBytes: number = DEFAULT_MAX_BODY_BYTES): Promise<JsonResult> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    return {
      ok: false,
      response: apiError(new AppError('VALIDATION', `请求体过大（上限 ${Math.floor(maxBytes / 1024)} KB）`)),
    };
  }

  const body = request.body;
  if (!body) {
    return { ok: false, response: apiError(new AppError('VALIDATION', '请求体不能为空')) };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return {
          ok: false,
          response: apiError(new AppError('VALIDATION', `请求体过大（上限 ${Math.floor(maxBytes / 1024)} KB）`)),
        };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, response: apiError(new AppError('VALIDATION', '读取请求体失败')) };
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, data: JSON.parse(new TextDecoder().decode(merged)) };
  } catch {
    return {
      ok: false,
      response: apiError(new AppError('VALIDATION', '请求体不是有效的 JSON')),
    };
  }
}

export function okJson(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function noContent(status: 204 | 200 = 204, init?: ResponseInit): NextResponse {
  return new NextResponse(null, { ...init, status });
}

/** 统一错误响应：AppError → 对应状态码；ZodError → 400；未知 → 500（不泄露细节）。 */
export function apiError(error: unknown, requestId: string = crypto.randomUUID()): NextResponse {
  if (error instanceof AppError) {
    const body: ApiErrorBody = { error: { code: error.code, message: error.message }, requestId };
    if (error.field) body.error.field = error.field;
    return NextResponse.json(body, { status: error.status, headers: { 'x-request-id': requestId } });
  }
  if (error instanceof ZodError) {
    const messages = zodErrorsToStrings(error);
    const limited = messages.slice(0, 5);
    if (messages.length > limited.length) limited.push(`另有 ${messages.length - limited.length} 项错误`);
    const body: ApiErrorBody = {
      error: { code: 'VALIDATION', message: limited.join('；').slice(0, 512) },
      requestId,
    };
    return NextResponse.json(body, { status: 400, headers: { 'x-request-id': requestId } });
  }
  console.error(`[api] unexpected error requestId=${requestId}:`, error);
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: '服务器内部错误' }, requestId },
    { status: 500, headers: { 'x-request-id': requestId } },
  );
}

/**
 * 路由最外层异常边界：捕获未知异常，并确保每个响应都携带同一个 request ID。
 * 错误 JSON 同时携带 requestId，便于用户报障与服务端日志关联。
 */
export function withApiErrors<Args extends unknown[]>(
  handler: (...args: Args) => Response | Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args): Promise<Response> => {
    const request = args[0] instanceof Request ? args[0] : null;
    const incomingId = request?.headers.get('x-request-id') ?? '';
    const requestId = /^[A-Za-z0-9._-]{1,64}$/.test(incomingId) ? incomingId : crypto.randomUUID();
    try {
      return await attachRequestId(await handler(...args), requestId);
    } catch (error) {
      return apiError(error, requestId);
    }
  };
}

async function attachRequestId(response: Response, requestId: string): Promise<Response> {
  if (response.status < 400 || !response.headers.get('content-type')?.includes('application/json')) {
    response.headers.set('x-request-id', requestId);
    return response;
  }
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    response.headers.set('x-request-id', requestId);
    return response;
  }
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    response.headers.set('x-request-id', requestId);
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('x-request-id', requestId);
  return NextResponse.json({ ...body, requestId }, { status: response.status, headers });
}
