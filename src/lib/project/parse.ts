/**
 * 项目文件导入（spec §5.3 导入规则）：复用 schemas.parseProjectFile 做严格校验
 * （体积上限/BOM/JSON/schema），本模块只做 UX 级包装与名称冲突处理。
 * 导入规则：hex 为准、code 仅展示（跨品牌可用）。
 */
import { LIMITS } from '@/lib/appInfo';
import { parseProjectFile } from '@/lib/schemas';
import type { ProjectFile } from '@/lib/types';

export type ImportProjectResult =
  | { ok: true; project: ProjectFile }
  | { ok: false; errors: string[] };

export function importProjectFile(text: string): ImportProjectResult {
  const result = parseProjectFile(text);
  return result.ok ? { ok: true, project: result.value } : { ok: false, errors: result.errors };
}

/**
 * 名称冲突自动加后缀：`名称` → `名称 (2)`；已有 `名称 (2)` → `名称 (3)`，依此类推。
 * 超过 100 字符上限时截断基础名，保证「基础名 + 后缀」恰好 ≤100 字符。
 */
export function conflictName(name: string, existingNames: readonly string[]): string {
  const limit = LIMITS.designNameLength;
  const existing = new Set(existingNames);
  if (!existing.has(name)) return name;
  for (let i = 2; i <= 9999; i++) {
    const suffix = ` (${i})`;
    const base = name.length + suffix.length > limit ? name.slice(0, limit - suffix.length).trimEnd() : name;
    const candidate = `${base}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return name; // 防御性回退（正常不可能到达：后缀序列唯一）
}
