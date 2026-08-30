/**
 * 分享快照（批次 K，决策 D38）。
 *
 * 分享出去的内容必须是「图纸本身」的最小集合：
 * - 只保留渲染只读页需要的字段（名称、创建时间、制作规格、格子与色板定义）；
 * - 明确剔除与作者、与本机相关的一切（原图/生成源本来就不上云，D13；
 *   这里再把 params 之类不需要公开的生成参数也去掉——它们对看图的人没有意义，
 *   却会暴露作者的调参习惯，而且将来参数结构变化会让老链接失效）。
 *
 * 快照与项目文件解耦：v3 不携带生成参数或套装档位。
 */
import type { Pattern, ProjectPalette } from '@/lib/types';
import {
  compatibleBoardProfilesForPalette,
  BOARD_PROFILE_IDS,
  type BoardProfileId,
} from '@/lib/boardProfiles';
import { z } from 'zod';
import {
  designNameSchema,
  patternSchema,
  projectFileSchema,
  projectPaletteSchema,
} from '@/lib/schemas';
import { firstPatternPaletteMismatch } from '@/lib/palettes/projectIntegrity';

export const SHARE_SNAPSHOT_VERSION = 3 as const;

export interface ShareSnapshot {
  version: typeof SHARE_SNAPSHOT_VERSION;
  name: string;
  createdAt: string;
  boardProfile: BoardProfileId;
  palette: ProjectPalette;
  pattern: Pattern;
}

const shareSnapshotSchema = z
  .object({
    version: z.literal(SHARE_SNAPSHOT_VERSION),
    name: designNameSchema,
    createdAt: z.string().datetime(),
    boardProfile: z.enum(BOARD_PROFILE_IDS),
    palette: projectPaletteSchema,
    pattern: patternSchema,
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (!compatibleBoardProfilesForPalette(snapshot.palette).some((profile) => profile.id === snapshot.boardProfile)) {
      ctx.addIssue({ code: 'custom', path: ['boardProfile'], message: '制作规格与所选色板不兼容' });
    }
    const mismatch = firstPatternPaletteMismatch(snapshot.pattern, snapshot.palette);
    if (mismatch) {
      ctx.addIssue({
        code: 'custom',
        path: ['pattern', 'cells', mismatch.cellIndex],
        message: '图纸颜色不属于分享色板',
      });
    }
  });

/** 从存库的项目 JSON 生成分享快照；数据不完整时返回 null（调用方回 400）。 */
export function shareSnapshotFromProject(project: unknown): ShareSnapshot | null {
  const parsed = projectFileSchema.safeParse(project);
  if (!parsed.success) return null;
  const source = parsed.data;
  return {
    version: SHARE_SNAPSHOT_VERSION,
    name: source.name,
    createdAt: source.createdAt,
    boardProfile: source.boardProfile,
    palette: source.paletteSelection.palette,
    pattern: source.pattern,
  };
}

/** 只读取严格 v3 快照；其他版本或损坏数据返回 null。 */
export function parseShareSnapshot(value: unknown): ShareSnapshot | null {
  const parsed = shareSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
