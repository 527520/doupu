/** API 限额守卫（spec E38）。 */
import { LIMITS } from '@/lib/appInfo';

/**
 * 项目体积守卫（单设计 JSON ≤5 MB）。
 * 注：schema 合法的项目（≤200×200 格）最大约 2.5MB，此分支为防御纵深；
 * 独立成纯函数以便单测（Next.js 路由文件不允许额外导出）。
 */
export function exceedsProjectLimit(project: unknown): boolean {
  try {
    return JSON.stringify(project).length > LIMITS.projectFileBytes;
  } catch {
    return true;
  }
}
