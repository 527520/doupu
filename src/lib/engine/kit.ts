/**
 * 空白起稿（H-2）与套装档位（H-3）。
 *
 * H-2 为什么需要：此前进入工作台的唯一入口是「上传一张图」。想从零画一个像素图案
 * （最常见的场景之一：照着别人的图纸自己摆、或者画个纯文字/图标）根本没有入口。
 * 空白图纸就是一张全透明的 Pattern，之后完全复用现有的像素编辑器。
 *
 * H-3 为什么需要：内置色板是「这个品牌一共有哪些颜色」，但用户手里往往只有一盒
 * 24 色或 48 色套装。用全色板生成会得到一堆买不到的色号（用户抱怨的常见问题）。
 * 档位就是从色板里按覆盖度挑出 N 个代表色，生成时只用这 N 色。
 */
import { buildLut, lutIndex } from './lut';
import { hexToRgb, oklabSquaredDistance, rgbToOklab } from './color';
import type { PaletteColor, PaletteSelection, Pattern, PatternCell } from '@/lib/types';
import { availablePaletteColors } from '@/lib/palettes/availability';
import { isKitTierAvailableForPalette, projectPaletteEngineColors } from '@/lib/kitTiers';
export { KIT_TIERS, type KitTier } from '@/lib/kitTiers';

/** 空白图纸：全透明格，尺寸与生成路径同一上限（20–200）。 */
export function createBlankPattern(width: number, height: number): Pattern {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('blank pattern size must be positive integers');
  }
  const cells: PatternCell[] = Array.from({ length: width * height }, () => ({
    hex: null,
    code: null,
    transparent: true,
  }));
  return { width, height, cells };
}

/** 套装档位（H-3）：常见成品套装规格。0 表示不限制（用整套色板）。 */
/**
 * 从色板里挑出 N 个代表色（H-3）。
 *
 * 规则：贪心「最远点采样」——先取最深与最浅（黑白是套装必备且最影响成品轮廓），
 * 之后每次选「与已选颜色的最小 Oklab 距离最大」的那个，直到 N 个。
 * 这样得到的子集覆盖整个色域，而不是像「取前 N 个色号」那样挤在一个色系里。
 * 完全确定性（同一输入必得同一子集），便于项目文件复现。
 */
export function selectKitColors(palette: PaletteColor[], size: number): PaletteColor[] {
  const available = availablePaletteColors(palette);
  if (size <= 0 || available.length <= size) return available;

  const labs = available.map((color) => {
    const rgb = hexToRgb(color.hex);
    if (!rgb) throw new Error(`invalid palette hex: ${color.hex}`);
    return rgbToOklab(rgb);
  });
  const luminance = labs.map((lab) => lab.l);
  const picked: number[] = [];
  const darkest = luminance.indexOf(Math.min(...luminance));
  const lightest = luminance.indexOf(Math.max(...luminance));
  picked.push(darkest);
  if (lightest !== darkest) picked.push(lightest);

  /** 每个候选到「已选集合」的最小距离，增量维护，避免每轮 O(n·k) 重算。 */
  const minDistance = labs.map((lab) => Math.min(...picked.map((index) => oklabSquaredDistance(lab, labs[index]))));

  while (picked.length < size) {
    let best = -1;
    let bestDistance = -1;
    for (let index = 0; index < available.length; index++) {
      if (picked.includes(index)) continue;
      const distance = minDistance[index];
      // 平手时取色号靠前的，保证确定性
      if (distance > bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    if (best < 0) break;
    picked.push(best);
    for (let index = 0; index < available.length; index++) {
      const distance = oklabSquaredDistance(labs[index], labs[best]);
      if (distance < minDistance[index]) minDistance[index] = distance;
    }
  }

  // 保持原色板顺序输出（色号有序，便于对照采购）
  return picked.sort((a, b) => a - b).map((index) => available[index]);
}

/** 持久化选择是色板身份和实际引擎色集的唯一事实来源。 */
export function paletteColorsForSelection(selection: PaletteSelection): PaletteColor[] {
  if (!isKitTierAvailableForPalette(selection.kitTier, selection.palette)) {
    throw new Error('套装档位超出当前色板可生成颜色数');
  }
  return selectKitColors(projectPaletteEngineColors(selection.palette), selection.kitTier);
}

/** 把「可用色号子集」应用到已有图纸（H-3 换档时用，语义同 remapPattern）。 */
export function nearestInKit(hex: string, kit: PaletteColor[]): PaletteColor {
  const available = availablePaletteColors(kit);
  if (available.length === 0) throw new Error('palette is empty');
  const lut = buildLut(available);
  const rgb = hexToRgb(hex);
  if (!rgb) throw new Error(`invalid hex: ${hex}`);
  return available[lutIndex(lut, rgb.r, rgb.g, rgb.b)];
}
