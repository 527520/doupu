/** API 限额守卫（spec E38）。 */
import { LIMITS } from '@/lib/appInfo';

/**
 * 项目体积守卫（单设计 JSON ≤5 MB）。
 * 注：schema 合法的项目（≤200×200 格）最大约 2.5MB，此分支为防御纵深；
 * 独立成纯函数以便单测（Next.js 路由文件不允许额外导出）。
 */
export function exceedsProjectLimit(project: unknown): boolean {
  try {
    // 用字节数而非 UTF-16 字符数：与请求体体积上限、项目文件解析的口径一致
    // （含中文/emoji 时字符数会明显低估实际体积）。
    return new TextEncoder().encode(JSON.stringify(project)).length > LIMITS.projectFileBytes;
  } catch {
    return true;
  }
}
