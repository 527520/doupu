/**
 * 内置色板数据模块（spec §F6）。
 * 数据出处：Zippland/perler-beads（AGPL-3.0）与 HansBug/pindou-color-data（MIT）。
 * 固定版本、生成方式及过滤策略见 ./data/README.md 与根目录 NOTICE.md。
 */
import pinnedExternalData from './data/pindou-color-data.generated.json';
import legacyCocoData from './data/legacy/coco.generated.json';
import legacyManmanData from './data/legacy/manman.generated.json';
import legacyMardData from './data/legacy/mard.generated.json';
import legacyMixiaowoData from './data/legacy/mixiaowo.generated.json';
import legacyPanpanData from './data/legacy/panpan.generated.json';
import {
  isBrand,
  type Brand,
  type BuiltinPaletteId,
  type ExternalBuiltinPaletteId,
  type ExternalBuiltinPaletteSourceId,
  type PaletteColor,
} from '@/lib/types';
import { zhCN } from '@/messages/zh-CN';
import { normalizeAvailableColorCode } from './availability';

export type { BuiltinPaletteId } from '@/lib/types';

interface RawExternalPaletteColor {
  code: string;
  hex: string;
  group: string;
  source: string;
  notes?: string;
  unidentified?: boolean;
  original_code?: string;
  transparency?: string;
}

interface RawExternalPalette {
  id: ExternalBuiltinPaletteSourceId;
  count: number;
  market: BuiltinPaletteMarket;
  sources: BuiltinPaletteSourceReference[];
  colors: RawExternalPaletteColor[];
}

interface VendoredExternalPalette {
  id: ExternalBuiltinPaletteSourceId;
  sourcePath: string;
  sourceSha256: string;
  analysis: {
    engineColorCount: number;
    exclusions: BuiltinPaletteExclusions;
  };
  data: RawExternalPalette;
}

interface VendoredExternalData {
  schema: 'doupu-vendored-pindou-color-data-v1';
  source: {
    repository: string;
    revision: string;
    license: 'MIT';
    manifestSha256: string;
    licenseSha256: string;
  };
  palettes: VendoredExternalPalette[];
}

interface VendoredLegacyPalette {
  schema: 'doupu-legacy-builtin-palette-v1';
  id: Brand;
  analysis: {
    engineColorCount: number;
    exclusions: BuiltinPaletteExclusions;
  };
  colors: Array<{ code: string | null; hex: string }>;
}

const VENDORED_LEGACY_BY_ID: ReadonlyMap<
  Brand,
  { filePath: string; data: VendoredLegacyPalette }
> = new Map([
  [
    'MARD',
    {
      filePath: 'src/lib/palettes/data/legacy/mard.generated.json',
      data: legacyMardData as VendoredLegacyPalette,
    },
  ],
  [
    'COCO',
    {
      filePath: 'src/lib/palettes/data/legacy/coco.generated.json',
      data: legacyCocoData as VendoredLegacyPalette,
    },
  ],
  [
    '漫漫',
    {
      filePath: 'src/lib/palettes/data/legacy/manman.generated.json',
      data: legacyManmanData as VendoredLegacyPalette,
    },
  ],
  [
    '盼盼',
    {
      filePath: 'src/lib/palettes/data/legacy/panpan.generated.json',
      data: legacyPanpanData as VendoredLegacyPalette,
    },
  ],
  [
    '咪小窝',
    {
      filePath: 'src/lib/palettes/data/legacy/mixiaowo.generated.json',
      data: legacyMixiaowoData as VendoredLegacyPalette,
    },
  ],
]);

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export type BuiltinPaletteGroup = 'legacy-domestic' | 'domestic' | 'artkal';
export type BuiltinPaletteExclusionReason =
  | 'unavailable-code'
  | 'transparent'
  | 'unidentified'
  | 'duplicate-hex';

export interface BuiltinPaletteColor {
  code: string | null;
  /** 展示层保留上游的 #RRGGBB 或 #RRGGBBAA。 */
  hex: string;
  group: string | null;
  sourceId: string | null;
  originalCode?: string;
  notes?: string;
  excludedReason?: BuiltinPaletteExclusionReason;
}

export interface BuiltinPaletteSourceReference {
  url: string;
  quality: string;
  notes: string;
}

export interface BuiltinPaletteSource {
  repository: string;
  revision: string;
  versionId: string;
  /** 上游仓库中的原始数据路径。 */
  path: string;
  /** 豆谱仓库中实际被目录读取的固定生成产物。 */
  vendoredPath: string;
  license: 'AGPL-3.0' | 'MIT';
  qualityLabel: string;
  qualitySummary: string;
  references: readonly BuiltinPaletteSourceReference[];
}

export interface BuiltinPaletteMarket {
  tier: string;
  score: number;
  label: string;
  summary: string;
}

export interface BuiltinPaletteExclusions {
  total: number;
  unavailableCode: number;
  transparent: number;
  unidentified: number;
  duplicateHex: number;
}

export interface BuiltinPalette {
  id: BuiltinPaletteId;
  label: string;
  brand: string;
  series: string;
  /** 品牌选择器切换到该品牌时应进入的唯一默认系列。 */
  defaultForBrand: boolean;
  description: string;
  group: BuiltinPaletteGroup;
  specification: string;
  source: BuiltinPaletteSource;
  market: BuiltinPaletteMarket | null;
  /** 完整展示数据，保留不可进入引擎的颜色及其排除原因。 */
  colors: readonly BuiltinPaletteColor[];
  /** 仅包含合法 #RRGGBB、已识别色号且 HEX 唯一的引擎输入。 */
  engineColors: readonly PaletteColor[];
  colorCount: number;
  engineColorCount: number;
  exclusions: BuiltinPaletteExclusions;
}

/** 列表页使用的轻量摘要；完整颜色只能通过 getBuiltinPalette 读取。 */
export type BuiltinPaletteSummary = Omit<BuiltinPalette, 'colors' | 'engineColors'>;

interface PaletteColorCandidate extends Omit<BuiltinPaletteColor, 'excludedReason'> {
  unidentified: boolean;
  transparent: boolean;
}

function preparePaletteColors(candidates: readonly PaletteColorCandidate[]): {
  colors: readonly BuiltinPaletteColor[];
  engineColors: readonly PaletteColor[];
  exclusions: BuiltinPaletteExclusions;
} {
  const seenEngineHexes = new Set<string>();
  const engineColors: PaletteColor[] = [];
  const counts = {
    unavailableCode: 0,
    transparent: 0,
    unidentified: 0,
    duplicateHex: 0,
  };

  const colors = candidates.map(({ unidentified, transparent, ...color }) => {
    const normalizedHex = color.hex.toUpperCase();
    const trimmedCode = color.code?.trim() ?? '';
    const normalizedCode = normalizeAvailableColorCode(color.code);
    let excludedReason: BuiltinPaletteExclusionReason | undefined;

    if (trimmedCode === '') {
      excludedReason = 'unavailable-code';
    } else if (transparent || /^#[0-9A-F]{8}$/.test(normalizedHex)) {
      excludedReason = 'transparent';
    } else if (unidentified || normalizedCode === null) {
      excludedReason = 'unidentified';
    } else if (!HEX_PATTERN.test(normalizedHex)) {
      throw new Error(`内置色板包含不支持的 HEX: ${color.hex}`);
    } else if (seenEngineHexes.has(normalizedHex)) {
      excludedReason = 'duplicate-hex';
    } else {
      seenEngineHexes.add(normalizedHex);
      engineColors.push(Object.freeze({ code: normalizedCode, hex: normalizedHex }));
    }

    if (excludedReason === 'unavailable-code') counts.unavailableCode += 1;
    if (excludedReason === 'transparent') counts.transparent += 1;
    if (excludedReason === 'unidentified') counts.unidentified += 1;
    if (excludedReason === 'duplicate-hex') counts.duplicateHex += 1;
    return Object.freeze({ ...color, ...(excludedReason ? { excludedReason } : {}) });
  });

  const exclusions = Object.freeze({
    ...counts,
    total: counts.unavailableCode + counts.transparent + counts.unidentified + counts.duplicateHex,
  });

  return {
    colors: Object.freeze(colors),
    engineColors: Object.freeze(engineColors),
    exclusions,
  };
}

const PINNED_EXTERNAL_REVISION = '178dafbc9e77d3de556550dbd058270200129186';
const vendoredExternalData = pinnedExternalData as unknown as VendoredExternalData;

if (
  vendoredExternalData.schema !== 'doupu-vendored-pindou-color-data-v1' ||
  vendoredExternalData.source.revision !== PINNED_EXTERNAL_REVISION
) {
  throw new Error('内置外部色板数据版本与目录 ID 不一致');
}

const VENDORED_EXTERNAL_BY_SOURCE_ID = new Map(
  vendoredExternalData.palettes.map((palette) => [palette.id, palette]),
);

function toVersionedExternalId(sourceId: ExternalBuiltinPaletteSourceId): ExternalBuiltinPaletteId {
  return `pcd:${sourceId}@${PINNED_EXTERNAL_REVISION}`;
}

interface CatalogStub {
  id: BuiltinPaletteId;
  sourceId?: ExternalBuiltinPaletteSourceId;
  group: BuiltinPaletteGroup;
  defaultForBrand: boolean;
  copy: {
    label: string;
    brand: string;
    series: string;
    description: string;
    specification: string;
    sourceQualityLabel: string;
    sourceQualitySummary: string;
  };
}

const catalogCopy = zhCN.palettes.builtinCatalog;
const CATALOG_STUBS: readonly CatalogStub[] = [
  { id: 'MARD', group: 'legacy-domestic', defaultForBrand: true, copy: catalogCopy.MARD },
  { id: 'COCO', group: 'legacy-domestic', defaultForBrand: true, copy: catalogCopy.COCO },
  { id: '漫漫', group: 'legacy-domestic', defaultForBrand: true, copy: catalogCopy.manmanLegacy },
  { id: '盼盼', group: 'legacy-domestic', defaultForBrand: true, copy: catalogCopy.panpanLegacy },
  { id: '咪小窝', group: 'legacy-domestic', defaultForBrand: true, copy: catalogCopy.mixiaowoLegacy },
  { id: toVersionedExternalId('mard-291-github'), sourceId: 'mard-291-github', group: 'domestic', defaultForBrand: false, copy: catalogCopy.mard291Public },
  { id: toVersionedExternalId('coco-291'), sourceId: 'coco-291', group: 'domestic', defaultForBrand: false, copy: catalogCopy.coco291Public },
  { id: toVersionedExternalId('manman-278'), sourceId: 'manman-278', group: 'domestic', defaultForBrand: false, copy: catalogCopy.manman278Public },
  { id: toVersionedExternalId('panpan-289'), sourceId: 'panpan-289', group: 'domestic', defaultForBrand: false, copy: catalogCopy.panpan289Public },
  { id: toVersionedExternalId('mixiaowo-290'), sourceId: 'mixiaowo-290', group: 'domestic', defaultForBrand: false, copy: catalogCopy.mixiaowo290Public },
  { id: toVersionedExternalId('mard-221-alfonse-doudou'), sourceId: 'mard-221-alfonse-doudou', group: 'domestic', defaultForBrand: false, copy: catalogCopy.mard221Reviewed },
  { id: toVersionedExternalId('artkal-c-197-official'), sourceId: 'artkal-c-197-official', group: 'artkal', defaultForBrand: true, copy: catalogCopy.artkalC197 },
  { id: toVersionedExternalId('artkal-m-221-official'), sourceId: 'artkal-m-221-official', group: 'artkal', defaultForBrand: false, copy: catalogCopy.artkalM221 },
];

interface CatalogRecord {
  stub: CatalogStub;
  legacy?: { filePath: string; data: VendoredLegacyPalette };
  external?: VendoredExternalPalette;
  summary: BuiltinPaletteSummary;
}

function createCatalogRecord(stub: CatalogStub): CatalogRecord {
  const legacyId = isBrand(stub.id) ? stub.id : null;
  const legacy = legacyId ? VENDORED_LEGACY_BY_ID.get(legacyId) : undefined;
  const external = stub.sourceId ? VENDORED_EXTERNAL_BY_SOURCE_ID.get(stub.sourceId) : undefined;
  if (legacyId && !legacy) throw new Error(`缺少独立旧色板数据: ${stub.id}`);
  if (!legacyId && !external) throw new Error(`缺少内置外部色板数据: ${stub.sourceId ?? stub.id}`);

  const isLegacy = legacy !== undefined;
  const analysis = legacy?.data.analysis ?? external!.analysis;
  const colorCount = legacy?.data.colors.length ?? external!.data.count;
  const { sourceQualityLabel, sourceQualitySummary, ...displayCopy } = stub.copy;
  const source: BuiltinPaletteSource = Object.freeze({
    repository: isLegacy ? 'Zippland/perler-beads' : 'HansBug/pindou-color-data',
    revision: isLegacy ? 'doupu-legacy-v1' : PINNED_EXTERNAL_REVISION,
    versionId: isLegacy
      ? `zippland-291-v1/${stub.id}`
      : `pindou-color-data@${PINNED_EXTERNAL_REVISION}/${stub.sourceId}`,
    path: isLegacy ? 'src/app/colorSystemMapping.json' : external!.sourcePath,
    vendoredPath: isLegacy
      ? legacy.filePath
      : `src/lib/palettes/data/pindou-color-data.generated.json#${stub.sourceId}`,
    license: isLegacy ? 'AGPL-3.0' : 'MIT',
    qualityLabel: sourceQualityLabel,
    qualitySummary: sourceQualitySummary,
    references: Object.freeze(
      isLegacy
        ? [
            Object.freeze({
              url: 'https://github.com/Zippland/perler-beads',
              quality: 'upstream_repository',
              notes: '豆谱既有五品牌映射的上游仓库。',
            }),
          ]
        : external!.data.sources.map((reference) => Object.freeze({ ...reference })),
    ),
  });
  const market = external
    ? Object.freeze({
        tier: external.data.market.tier,
        score: external.data.market.score,
        label: external.data.market.label,
        summary: external.data.market.summary,
      })
    : null;
  const exclusions = Object.freeze({ ...analysis.exclusions });
  const summary: BuiltinPaletteSummary = Object.freeze({
    id: stub.id,
    defaultForBrand: stub.defaultForBrand,
    ...displayCopy,
    group: stub.group,
    source,
    market,
    colorCount,
    engineColorCount: analysis.engineColorCount,
    exclusions,
  });

  if (summary.colorCount - summary.exclusions.total !== summary.engineColorCount) {
    throw new Error(`内置色板预生成统计不一致: ${summary.id}`);
  }
  return Object.freeze({ stub, legacy, external, summary });
}

const CATALOG_RECORDS: readonly CatalogRecord[] = Object.freeze(CATALOG_STUBS.map(createCatalogRecord));
const CATALOG_RECORDS_BY_ID = new Map(CATALOG_RECORDS.map((record) => [record.stub.id, record]));
const BUILTIN_PALETTE_IDS = new Set<BuiltinPaletteId>(CATALOG_RECORDS_BY_ID.keys());
const BUILTIN_PALETTE_SUMMARIES: readonly BuiltinPaletteSummary[] = Object.freeze(
  CATALOG_RECORDS.map((record) => record.summary),
);
const BUILTIN_PALETTE_CACHE = new Map<BuiltinPaletteId, BuiltinPalette>();

export function listBuiltinPalettes(): readonly BuiltinPaletteSummary[] {
  return BUILTIN_PALETTE_SUMMARIES;
}

export function isBuiltinPaletteId(value: unknown): value is BuiltinPaletteId {
  return typeof value === 'string' && BUILTIN_PALETTE_IDS.has(value as BuiltinPaletteId);
}

export function getBuiltinPalette(id: BuiltinPaletteId): BuiltinPalette {
  const cached = BUILTIN_PALETTE_CACHE.get(id);
  if (cached) return cached;

  const record = CATALOG_RECORDS_BY_ID.get(id);
  if (!record) throw new Error(`未知内置色板: ${id}`);
  const candidates: PaletteColorCandidate[] = record.legacy
    ? record.legacy.data.colors.map((color) => ({
        ...color,
        group: null,
        sourceId: null,
        unidentified: false,
        transparent: false,
      }))
    : record.external!.data.colors.map((color) => ({
        code: color.code,
        hex: color.hex,
        group: color.group,
        sourceId: color.source,
        unidentified: color.unidentified === true,
        transparent: color.transparency !== undefined,
        ...(color.original_code === undefined ? {} : { originalCode: color.original_code }),
        ...(color.notes === undefined ? {} : { notes: color.notes }),
      }));
  const prepared = preparePaletteColors(candidates);
  if (
    prepared.colors.length !== record.summary.colorCount ||
    prepared.engineColors.length !== record.summary.engineColorCount ||
    prepared.exclusions.total !== record.summary.exclusions.total ||
    prepared.exclusions.unavailableCode !== record.summary.exclusions.unavailableCode ||
    prepared.exclusions.transparent !== record.summary.exclusions.transparent ||
    prepared.exclusions.unidentified !== record.summary.exclusions.unidentified ||
    prepared.exclusions.duplicateHex !== record.summary.exclusions.duplicateHex
  ) {
    throw new Error(`内置色板运行时统计与预生成摘要不一致: ${id}`);
  }

  const palette: BuiltinPalette = Object.freeze({
    ...record.summary,
    colors: prepared.colors,
    engineColors: prepared.engineColors,
  });
  BUILTIN_PALETTE_CACHE.set(id, palette);
  return palette;
}
