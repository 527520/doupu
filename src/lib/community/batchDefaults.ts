import { z } from 'zod';
import { BOARD_PROFILE_IDS, DEFAULT_BOARD_PROFILE_ID, compatibleBoardProfilesForPalette, type BoardProfileId } from '@/lib/boardProfiles';
import { isKitTierAvailableForPalette } from '@/lib/kitTiers';
import { generationParamsSchema, paletteSelectionSchema } from '@/lib/schemas';
import type { GenerationParams, PaletteSelection } from '@/lib/types';

/** 官方批次的制作规格：底板 + 色板 / 套装档位。此前硬编码为 5mm·29×29 + MARD 全色板。 */
export interface OfficialBatchSpec {
  boardProfile: BoardProfileId;
  paletteSelection: PaletteSelection;
}

export const DEFAULT_OFFICIAL_BATCH_SPEC: OfficialBatchSpec = {
  boardProfile: DEFAULT_BOARD_PROFILE_ID,
  paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 },
};

/**
 * 批次默认参数 = 生成参数 + 可选制作规格。规格字段可选，旧批次记录（只有生成参数）仍能解析；
 * 规格缺失时按 DEFAULT_OFFICIAL_BATCH_SPEC 处理。
 */
export const officialBatchDefaultsSchema = generationParamsSchema.extend({
  boardProfile: z.enum(BOARD_PROFILE_IDS).optional(),
  paletteSelection: paletteSelectionSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.boardProfile && value.paletteSelection && !compatibleBoardProfilesForPalette(value.paletteSelection.palette).some((profile) => profile.id === value.boardProfile)) {
    ctx.addIssue({ code: 'custom', path: ['boardProfile'], message: '制作规格与色板不兼容' });
  }
});

export type OfficialBatchDefaults = z.infer<typeof officialBatchDefaultsSchema>;

export function isValidOfficialBatchSpec(spec: OfficialBatchSpec): boolean {
  return compatibleBoardProfilesForPalette(spec.paletteSelection.palette).some((profile) => profile.id === spec.boardProfile)
    && isKitTierAvailableForPalette(spec.paletteSelection.kitTier, spec.paletteSelection.palette);
}

export function splitOfficialBatchDefaults(defaults: OfficialBatchDefaults): { params: GenerationParams; spec: OfficialBatchSpec } {
  const { boardProfile, paletteSelection, ...params } = defaults;
  return {
    params: { ...params, backgroundPrototype: params.backgroundPrototype ?? null },
    spec: boardProfile && paletteSelection ? { boardProfile, paletteSelection } : { ...DEFAULT_OFFICIAL_BATCH_SPEC },
  };
}

export function mergeOfficialBatchDefaults(params: GenerationParams, spec: OfficialBatchSpec): OfficialBatchDefaults {
  return { ...params, backgroundPrototype: params.backgroundPrototype ?? null, boardProfile: spec.boardProfile, paletteSelection: spec.paletteSelection };
}
