/**
 * 分享快照（批次 K，决策 D38）。
 *
 * 分享出去的内容必须是「图纸本身」的最小集合：
 * - 只保留渲染只读页需要的字段（尺寸、格子、色板声明、名称、创建时间）；
 * - 明确剔除与作者、与本机相关的一切（原图/生成源本来就不上云，D13；
 *   这里再把 params 之类不需要公开的生成参数也去掉——它们对看图的人没有意义，
 *   却会暴露作者的调参习惯，而且将来参数结构变化会让老链接失效）。
 *
 * 快照与项目文件解耦：项目文件格式升级时，老的分享链接仍然能渲染。
 */
import type { Pattern, ProjectFile, ProjectPalette } from '@/lib/types';

export const SHARE_SNAPSHOT_VERSION = 1 as const;

export interface ShareSnapshot {
  version: typeof SHARE_SNAPSHOT_VERSION;
  name: string;
  createdAt: string;
  palette: ProjectPalette;
  pattern: Pattern;
}

function isPattern(value: unknown): value is Pattern {
  if (!value || typeof value !== 'object') return false;
  const pattern = value as Partial<Pattern>;
  return Number.isInteger(pattern.width)
    && Number.isInteger(pattern.height)
    && Array.isArray(pattern.cells)
    && pattern.cells.length === (pattern.width as number) * (pattern.height as number)
    && (pattern.width as number) > 0
    && (pattern.height as number) > 0;
}

/** 从存库的项目 JSON 生成分享快照；数据不完整时返回 null（调用方回 400）。 */
export function shareSnapshotFromProject(project: unknown): ShareSnapshot | null {
  if (!project || typeof project !== 'object') return null;
  const source = project as Partial<ProjectFile>;
  if (!isPattern(source.pattern)) return null;
  if (!source.palette || typeof source.palette !== 'object') return null;
  return {
    version: SHARE_SNAPSHOT_VERSION,
    name: typeof source.name === 'string' ? source.name : '',
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date(0).toISOString(),
    palette: source.palette as ProjectPalette,
    pattern: source.pattern,
  };
}

/** 读取库里存的快照（老版本或损坏数据返回 null）。 */
export function parseShareSnapshot(value: unknown): ShareSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ShareSnapshot>;
  if (raw.version !== SHARE_SNAPSHOT_VERSION) return null;
  if (!isPattern(raw.pattern)) return null;
  if (!raw.palette || typeof raw.palette !== 'object') return null;
  return {
    version: SHARE_SNAPSHOT_VERSION,
    name: typeof raw.name === 'string' ? raw.name : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
    palette: raw.palette,
    pattern: raw.pattern,
  };
}
