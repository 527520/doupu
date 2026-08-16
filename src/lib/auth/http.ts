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
export function apiError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
    if (error.field) body.error.field = error.field;
    return NextResponse.json(body, { status: error.status });
  }
  if (error instanceof ZodError) {
    const body: ApiErrorBody = {
      error: { code: 'VALIDATION', message: zodErrorsToStrings(error).join('；') },
    };
    return NextResponse.json(body, { status: 400 });
  }
  console.error('[api] unexpected error:', error);
  return NextResponse.json({ error: { code: 'INTERNAL', message: '服务器内部错误' } }, { status: 500 });
}
