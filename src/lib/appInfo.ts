/** 应用级常量：名称、版本、外部链接。 */
export const APP_NAME = '豆谱';
export const APP_VERSION = '0.3.0';
export const SOURCE_REPO_URL = 'https://github.com/527520/doupu';
export const ISSUES_URL = 'https://github.com/527520/doupu/issues';
export const AUTHOR_NAME = 'wuqian';
export const AUTHOR_GITHUB_URL = 'https://github.com/527520';
export const CONTACT_EMAIL = 'wqa527520@qq.com';
export const PROJECT_FILE_FORMAT = 'doupu-project' as const;
export const PROJECT_FILE_VERSION = 2 as const;
/** Changes whenever generation semantics can produce a materially different pattern. */
export const ENGINE_VERSION = '2.0.0' as const;

/** 规格约束（spec §F1/F3/F6/F8），全项目唯一来源。 */
export const LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxPixels: 8000 * 8000,
  /** 裁剪后可持久化及发送给生成引擎的最长边像素。 */
  generationSourceDimension: 200 * 4,
  targetWidth: { min: 20, max:200 },
  targetColorCount: { min: 2, max: 128 },
  gridCells: 200 * 200,
  designNameLength: 100,
  projectFileBytes: 5 * 1024 * 1024,
  designsPerUser: 100,
  /** Includes active rows and compact tombstones retained for sync. */
  designRowsPerUser: 200,
  designBytesPerUser: 50 * 1024 * 1024,
  palettesPerUser: 20,
  paletteRowsPerUser: 40,
  paletteBytesPerUser: 5 * 1024 * 1024,
  customPaletteColors: 500,
  customPaletteCodeLength: 20,
  usernameLength: 30,
  password: { min: 8, max: 72 },
} as const;

/** 画布显示约束（优化票 12 盘点 #21：收拢自组件的魔法数字）。 */
export const CANVAS_UI = {
  /** 画布最大显示高度（px）：等比缩放时长边不超过此值，避免长图纸占满整屏。 */
  maxDisplayHeight: 560,
  /** 容器两侧内边距合计（px，Tailwind p-2 = 8px×2）：计算可用宽度时扣除。 */
  containerPadding: 16,
  /** 编辑画布像素总量上限：格尺寸按此封顶，避免超大画布内存/性能失控。 */
  editorMaxCanvasPx: 4096,
} as const;
