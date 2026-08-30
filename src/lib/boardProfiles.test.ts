import { describe, expect, it } from 'vitest';
import { config } from '@/lib/config';
import {
  BOARD_PROFILE_IDS,
  compatibleBoardProfilesForPalette,
  DEFAULT_BOARD_PROFILE_ID,
  defaultBoardProfileForPalette,
  getBoardProfile,
  isBoardProfileId,
} from './boardProfiles';
import type { ProjectPalette } from '@/lib/types';

describe('boardProfiles registry', () => {
  it('returns the three supported physical board specifications from stable ids', () => {
    expect(BOARD_PROFILE_IDS).toEqual(['5mm-29', '2.6mm-50', '2.6mm-52']);
    expect(DEFAULT_BOARD_PROFILE_ID).toBe('5mm-29');
    expect(getBoardProfile('5mm-29')).toEqual({
      id: '5mm-29',
      displayName: '5mm / 29×29',
      beadDiameterMm: 5,
      boardRows: 29,
      boardCols: 29,
      pdfCellMm: config.exportPdf.cellMm,
    });
    expect(getBoardProfile('2.6mm-50')).toEqual({
      id: '2.6mm-50',
      displayName: '2.6mm / 50×50',
      beadDiameterMm: 2.6,
      boardRows: 50,
      boardCols: 50,
      pdfCellMm: 2.6,
    });
    expect(getBoardProfile('2.6mm-52')).toEqual({
      id: '2.6mm-52',
      displayName: '2.6mm / 52×52',
      beadDiameterMm: 2.6,
      boardRows: 52,
      boardCols: 52,
      pdfCellMm: 2.6,
    });
    expect(isBoardProfileId('2.6mm-50')).toBe(true);
    expect(isBoardProfileId('unknown')).toBe(false);
    expect(() => getBoardProfile('unknown' as never)).toThrow('unknown');
  });
});

describe('palette compatibility', () => {
  const builtin = (brand: string): ProjectPalette => ({ kind: 'builtin', brand } as ProjectPalette);
  const custom: ProjectPalette = {
    kind: 'custom',
    colors: [{ code: 'A', hex: '#FFFFFF' }],
  };

  it('keeps every compatibility and fallback decision behind one interface', () => {
    expect(compatibleBoardProfilesForPalette(builtin('pcd:artkal-c-197-official@178dafbc9e77d3de556550dbd058270200129186')).map(({ id }) => id))
      .toEqual(['2.6mm-50', '2.6mm-52']);
    expect(defaultBoardProfileForPalette(builtin('pcd:artkal-c-197-official@178dafbc9e77d3de556550dbd058270200129186'), '5mm-29'))
      .toBe('2.6mm-50');
    expect(defaultBoardProfileForPalette(builtin('pcd:artkal-m-221-official@178dafbc9e77d3de556550dbd058270200129186'), '2.6mm-52'))
      .toBe('2.6mm-52');

    expect(compatibleBoardProfilesForPalette(builtin('pcd:mard-221-alfonse-doudou@178dafbc9e77d3de556550dbd058270200129186')).map(({ id }) => id))
      .toEqual(BOARD_PROFILE_IDS);
    expect(defaultBoardProfileForPalette(builtin('pcd:mard-221-alfonse-doudou@178dafbc9e77d3de556550dbd058270200129186'), '2.6mm-52'))
      .toBe('2.6mm-52');
    expect(defaultBoardProfileForPalette(builtin('pcd:mard-221-alfonse-doudou@178dafbc9e77d3de556550dbd058270200129186'))).toBe('5mm-29');

    expect(compatibleBoardProfilesForPalette(builtin('MARD')).map(({ id }) => id))
      .toEqual(['5mm-29']);
    expect(defaultBoardProfileForPalette(builtin('MARD'), '2.6mm-50')).toBe('5mm-29');

    expect(compatibleBoardProfilesForPalette(custom).map(({ id }) => id)).toEqual(BOARD_PROFILE_IDS);
    expect(defaultBoardProfileForPalette(custom, '2.6mm-50')).toBe('2.6mm-50');
    expect(defaultBoardProfileForPalette(custom)).toBe('5mm-29');
  });
});
