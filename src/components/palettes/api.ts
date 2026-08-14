/**
 * 自定义色板客户端 API 辅助（对接 /api/palettes，T16 契约）。
 * 供 /palettes 页面使用；getPaletteColors 同时是工作台接入自定义色板的接缝（T19）。
 */
import type { CustomPaletteColor, PaletteColor } from '@/lib/types';

export interface PaletteRecord {
  id: string;
  name: string;
  colors: CustomPaletteColor[];
  updatedAt: string;
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string; field?: string };
}

export class PalettesApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PalettesApiError';
    this.code = code;
  }
}

async function parseError(response: Response, fallback: string): Promise<never> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // 非 JSON 响应：使用回退文案
  }
  const code = body.error?.code ?? String(response.status);
  const message = body.error?.message ?? fallback;
  throw new PalettesApiError(code, message);
}

/** 当前用户的自定义色板列表。 */
export async function listPalettes(): Promise<PaletteRecord[]> {
  const response = await fetch('/api/palettes', { cache: 'no-store' });
  if (response.status === 401) {
    throw new PalettesApiError('UNAUTHORIZED', '未登录');
  }
  if (!response.ok) return parseError(response, '加载失败');
  return (await response.json()) as PaletteRecord[];
}

/** 幂等 upsert（客户端 UUID）。 */
export async function savePalette(
  id: string,
  name: string,
  colors: CustomPaletteColor[],
): Promise<PaletteRecord> {
  const response = await fetch(`/api/palettes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, colors }),
  });
  if (!response.ok) return parseError(response, '保存失败');
  return (await response.json()) as PaletteRecord;
}

/** 墓碑删除（幂等 204）。 */
export async function deletePalette(id: string): Promise<void> {
  const response = await fetch(`/api/palettes/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok && response.status !== 404) {
    return parseError(response, '删除失败');
  }
}

/**
 * 工作台接入接缝（T19）：把自定义色板记录转换为生成引擎可用的 PaletteColor[]。
 * hex 为准；code 缺失的条目跳过（引擎要求 code 非空）。
 */
export function getPaletteColors(record: PaletteRecord): PaletteColor[] {
  return record.colors
    .filter((color) => color.code && color.code.trim().length > 0)
    .map((color) => ({ hex: color.hex, code: color.code }));
}

/** 生成客户端 UUID（测试环境兜底）。 */
export function newPaletteId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
