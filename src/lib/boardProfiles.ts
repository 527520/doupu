import { config } from '@/lib/config';
import type { BuiltinPaletteId, ProjectPalette } from '@/lib/types';
import { zhCN } from '@/messages/zh-CN';

/** Stable persisted ids for the physical bead and pegboard combination. */
export const BOARD_PROFILE_IDS = ['5mm-29', '2.6mm-50', '2.6mm-52'] as const;

export type BoardProfileId = (typeof BOARD_PROFILE_IDS)[number];

export interface BoardProfile {
  readonly id: BoardProfileId;
  readonly displayName: string;
  readonly beadDiameterMm: number;
  readonly boardRows: number;
  readonly boardCols: number;
  readonly pdfCellMm: number;
}

export const DEFAULT_BOARD_PROFILE_ID: BoardProfileId = '5mm-29';

const BOARD_PROFILES: Readonly<Record<BoardProfileId, BoardProfile>> = Object.freeze({
  '5mm-29': Object.freeze({
    id: '5mm-29',
    displayName: zhCN.params.boardProfileNames['5mm-29'],
    beadDiameterMm: 5,
    boardRows: 29,
    boardCols: 29,
    pdfCellMm: config.exportPdf.cellMm,
  }),
  '2.6mm-50': Object.freeze({
    id: '2.6mm-50',
    displayName: zhCN.params.boardProfileNames['2.6mm-50'],
    beadDiameterMm: 2.6,
    boardRows: 50,
    boardCols: 50,
    pdfCellMm: 2.6,
  }),
  '2.6mm-52': Object.freeze({
    id: '2.6mm-52',
    displayName: zhCN.params.boardProfileNames['2.6mm-52'],
    beadDiameterMm: 2.6,
    boardRows: 52,
    boardCols: 52,
    pdfCellMm: 2.6,
  }),
});

/** Legacy-compatible default used only by callers that have no persisted profile yet. */
export const DEFAULT_BOARD_SIZE = BOARD_PROFILES[DEFAULT_BOARD_PROFILE_ID].boardCols;

export function isBoardProfileId(value: unknown): value is BoardProfileId {
  return typeof value === 'string' && (BOARD_PROFILE_IDS as readonly string[]).includes(value);
}

export function getBoardProfile(id: BoardProfileId): BoardProfile {
  if (!isBoardProfileId(id)) throw new RangeError(`Unknown board profile: ${String(id)}`);
  return BOARD_PROFILES[id];
}

const ALL_BOARD_PROFILES = Object.freeze(BOARD_PROFILE_IDS.map(getBoardProfile));
const STANDARD_BOARD_PROFILES = Object.freeze([getBoardProfile('5mm-29')]);
const MINI_BOARD_PROFILES = Object.freeze([
  getBoardProfile('2.6mm-50'),
  getBoardProfile('2.6mm-52'),
]);

const MARD_221_PALETTE_ID =
  'pcd:mard-221-alfonse-doudou@178dafbc9e77d3de556550dbd058270200129186' satisfies BuiltinPaletteId;

const MINI_ONLY_PALETTE_IDS = new Set<BuiltinPaletteId>([
  'pcd:artkal-c-197-official@178dafbc9e77d3de556550dbd058270200129186',
  'pcd:artkal-m-221-official@178dafbc9e77d3de556550dbd058270200129186',
]);

function isMiniOnlyPalette(palette: ProjectPalette): boolean {
  return palette.kind === 'builtin' && MINI_ONLY_PALETTE_IDS.has(palette.brand);
}

/** Physical specifications that can be used with a persisted palette declaration. */
export function compatibleBoardProfilesForPalette(palette: ProjectPalette): readonly BoardProfile[] {
  if (palette.kind === 'custom' || palette.brand === MARD_221_PALETTE_ID) {
    return ALL_BOARD_PROFILES;
  }
  if (isMiniOnlyPalette(palette)) return MINI_BOARD_PROFILES;
  return STANDARD_BOARD_PROFILES;
}

/**
 * Keeps the current choice when it remains compatible. Otherwise returns the
 * palette's declared fallback (Artkal mini: 50×50; everything else: 5mm).
 */
export function defaultBoardProfileForPalette(
  palette: ProjectPalette,
  current?: BoardProfileId,
): BoardProfileId {
  const compatible = compatibleBoardProfilesForPalette(palette);
  if (current && compatible.some((profile) => profile.id === current)) return current;
  return isMiniOnlyPalette(palette)
    ? '2.6mm-50'
    : DEFAULT_BOARD_PROFILE_ID;
}
