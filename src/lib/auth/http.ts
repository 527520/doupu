/**
 * API 响应工具：JSON 解析、统一错误体（spec §4.2），绝不泄露内部细节。
 */
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError, type ApiErrorBody } from '@/lib/errors';
import { zodErrorsToStrings } from '@/lib/schemas';

export type JsonResult = { ok: true; data: unknown } | { ok: false; response: NextResponse };

/** 解析 JSON 请求体；失败返回 400 VALIDATION。 */
export async function readJson(request: Request): Promise<JsonResult> {
  try {
    const data = await request.json();
    return { ok: true, data };
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

export function noContent(status: 204 | 200 = 204): NextResponse {
  return new NextResponse(null, { status });
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
