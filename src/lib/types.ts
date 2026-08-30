/**
 * 豆谱领域核心类型（spec §4.1）。
 * 客户端与服务端共享的唯一事实来源。
 */
import type { BoardProfileId } from './boardProfiles';
import type { KitTier } from './kitTiers';

export type { BoardProfileId } from './boardProfiles';
export type { KitTier } from './kitTiers';

/** 内置拼豆品牌（spec §F6）。 */
export type Brand = 'MARD' | 'COCO' | '漫漫' | '盼盼' | '咪小窝';

/** Pinned upstream ids used to derive source-versioned persisted palette ids. */
export type ExternalBuiltinPaletteSourceId =
  | 'mard-291-github'
  | 'coco-291'
  | 'manman-278'
  | 'panpan-289'
  | 'mixiaowo-290'
  | 'mard-221-alfonse-doudou'
  | 'artkal-c-197-official'
  | 'artkal-m-221-official';

export type ExternalBuiltinPaletteRevision = '178dafbc9e77d3de556550dbd058270200129186';

export type ExternalBuiltinPaletteId =
  `pcd:${ExternalBuiltinPaletteSourceId}@${ExternalBuiltinPaletteRevision}`;

/** Stable persisted palette id. Legacy Brand values remain valid forever. */
export type BuiltinPaletteId = Brand | ExternalBuiltinPaletteId;

export const BRANDS: readonly Brand[] = ['MARD', 'COCO', '漫漫', '盼盼', '咪小窝'];

export function isBrand(value: string): value is Brand {
  return (BRANDS as readonly string[]).includes(value);
}

/** 色板中的一个颜色：hex 为 #RRGGBB；code 为该品牌色号，无对应色号时为 null。 */
export interface PaletteColor {
  hex: string;
  code: string | null;
}

/** 格元取样模式（spec §F3）。 */
export type SampleMode = 'dominant' | 'average';

/** 生成参数（spec §F3）。 */
export interface GenerationParams {
  /** 目标宽度（格数），20–200 */
  targetWidth: number;
  /** 目标颜色数，2–128 */
  targetColorCount: number;
  dithering: boolean;
  mode: SampleMode;
  /** -100–100 */
  brightness: number;
  /** -100–100 */
  contrast: number;
  backgroundRemoval: boolean;
  /** 背景容差，0–40 */
  bgTolerance: number;
  /** 手动背景原型；null/省略时使用四角共识自动检测。 */
  backgroundPrototype?: string | null;
}

export const DEFAULT_GENERATION_PARAMS: GenerationParams = {
  targetWidth: 100,
  targetColorCount: 40,
  dithering: false,
  mode: 'dominant',
  brightness: 0,
  contrast: 0,
  backgroundRemoval: false,
  bgTolerance: 8,
  backgroundPrototype: null,
};

/** 图纸单元格：透明格 hex/code 均为 null；非透明格 hex 必填。external 为背景去除标记（默认 false）。 */
export interface PatternCell {
  hex: string | null;
  code: string | null;
  transparent: boolean;
  external?: boolean;
}

/** 图纸（row-major cells）。 */
export interface Pattern {
  width: number;
  height: number;
  cells: PatternCell[];
}

/** 用量统计项（按数量降序）。 */
export interface PatternStatsItem {
  code: string;
  hex: string;
  count: number;
}

/** 自定义色板中的颜色。 */
export interface CustomPaletteColor {
  code: string;
  hex: string;
}

/** 自定义色板。 */
export interface CustomPalette {
  id?: string;
  name: string;
  colors: CustomPaletteColor[];
  updatedAt?: string;
}

/** 项目文件中的色板引用（spec §5.3）。 */
export type ProjectPalette =
  | { kind: 'builtin'; brand: BuiltinPaletteId }
  | { kind: 'custom'; colors: CustomPaletteColor[] };

/** 可复现生成所需的色板定义与套装档位。 */
export interface PaletteSelection {
  palette: ProjectPalette;
  kitTier: KitTier;
}

/** 项目文件（spec §5.3）。 */
export interface ProjectFile {
  format: 'doupu-project';
  version: 3;
  /** Engine semantics used to produce the committed pattern. */
  engineVersion: string;
  /** Physical bead and pegboard specification used by this design. */
  boardProfile: BoardProfileId;
  name: string;
  createdAt: string;
  updatedAt: string;
  paletteSelection: PaletteSelection;
  params: GenerationParams;
  pattern: Pattern;
}

/** 设计元数据（列表展示用，spec §4.2）。 */
export interface DesignMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  updatedAt: string;
  thumbnail: string | null;
}
