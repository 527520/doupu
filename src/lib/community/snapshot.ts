import { z } from 'zod';
import { BOARD_PROFILE_IDS } from '@/lib/boardProfiles';
import {
  generationParamsSchema,
  paletteSelectionSchema,
  patternSchema,
  projectFileSchema,
} from '@/lib/schemas';
import type { Pattern, ProjectFile } from '@/lib/types';

export const COMMUNITY_SNAPSHOT_VERSION = 1 as const;
export const COMMUNITY_LICENSE_VERSION = 'limited-platform-license-v1-draft' as const;

export const communitySnapshotSchema = z.object({
  version: z.literal(COMMUNITY_SNAPSHOT_VERSION),
  engineVersion: z.string().min(1).max(80),
  boardProfile: z.enum(BOARD_PROFILE_IDS),
  paletteSelection: paletteSelectionSchema,
  params: generationParamsSchema,
  pattern: patternSchema,
}).strict();

export type CommunitySnapshotV1 = z.infer<typeof communitySnapshotSchema>;

export interface CommunityPreviewV1 {
  version: 1;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  cells: Array<string | null>;
  colorBand: string[];
}

export const communityPreviewSchema: z.ZodType<CommunityPreviewV1> = z.object({
  version: z.literal(1),
  width: z.number().int().min(1).max(48),
  height: z.number().int().min(1).max(48),
  originalWidth: z.number().int().min(1).max(200),
  originalHeight: z.number().int().min(1).max(200),
  cells: z.array(z.string().regex(/^#[0-9A-F]{6}$/u).nullable()).max(48 * 48),
  colorBand: z.array(z.string().regex(/^#[0-9A-F]{6}$/u)).max(12),
}).strict().superRefine((preview, ctx) => {
  if (preview.cells.length !== preview.width * preview.height) {
    ctx.addIssue({ code: 'custom', path: ['cells'], message: '预览格数量与尺寸不一致' });
  }
});

export function communitySnapshotFromProject(project: unknown): CommunitySnapshotV1 | null {
  const parsed = projectFileSchema.safeParse(project);
  if (!parsed.success) return null;
  return freezeProject(parsed.data);
}

function freezeProject(project: ProjectFile): CommunitySnapshotV1 {
  return {
    version: COMMUNITY_SNAPSHOT_VERSION,
    engineVersion: project.engineVersion,
    boardProfile: project.boardProfile,
    paletteSelection: structuredClone(project.paletteSelection),
    params: { ...structuredClone(project.params), backgroundPrototype: project.params.backgroundPrototype ?? null },
    pattern: structuredClone(project.pattern),
  };
}

export function parseCommunitySnapshot(value: unknown): CommunitySnapshotV1 | null {
  const parsed = communitySnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function deriveCommunityPreview(pattern: Pattern): CommunityPreviewV1 {
  const scale = Math.min(1, 48 / pattern.width, 48 / pattern.height);
  const width = Math.max(1, Math.round(pattern.width * scale));
  const height = Math.max(1, Math.round(pattern.height * scale));
  const cells: Array<string | null> = [];
  const counts = new Map<string, number>();
  for (const cell of pattern.cells) {
    if (!cell.transparent && !cell.external && cell.hex) {
      counts.set(cell.hex, (counts.get(cell.hex) ?? 0) + 1);
    }
  }
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(pattern.height - 1, Math.floor(((y + 0.5) * pattern.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(pattern.width - 1, Math.floor(((x + 0.5) * pattern.width) / width));
      const cell = pattern.cells[sourceY * pattern.width + sourceX];
      cells.push(cell && !cell.transparent && !cell.external ? cell.hex : null);
    }
  }
  const colorBand = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 12)
    .map(([hex]) => hex);
  return {
    version: 1,
    width,
    height,
    originalWidth: pattern.width,
    originalHeight: pattern.height,
    cells,
    colorBand,
  };
}

export function snapshotColorCount(snapshot: CommunitySnapshotV1): number {
  return new Set(snapshot.pattern.cells.flatMap((cell) => (
    !cell.transparent && !cell.external && cell.hex ? [cell.hex] : []
  ))).size;
}

export function snapshotPaletteIdentity(snapshot: CommunitySnapshotV1): { kind: 'builtin' | 'custom'; id: string | null } {
  return snapshot.paletteSelection.palette.kind === 'builtin'
    ? { kind: 'builtin', id: snapshot.paletteSelection.palette.brand }
    : { kind: 'custom', id: null };
}
