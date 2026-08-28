/**
 * 采购清单（F-3）。
 *
 * 用量统计只给「每个色号多少粒」，但用户真正要做的是「照着买」：
 * 需要知道每色占比（决定优先买哪些）、按包换算要买几包（散装豆按包卖），
 * 以及一份能直接发给店家的纯文本。
 *
 * 不做金额估算：各家单价与包装差异大且随时变动，算出来的金额只会误导。
 */
import type { PatternStatsItem } from '@/lib/types';

/** 每包颗数的默认值：国产散装豆常见规格；可在界面上改（F-3 决策 Q12c）。 */
export const DEFAULT_BEADS_PER_PACK = 1000;

export interface ShoppingItem {
  code: string;
  hex: string;
  count: number;
  /** 占总粒数的百分比（0–100，保留一位小数） */
  share: number;
  /** 按每包颗数向上取整的包数 */
  packs: number;
}

export interface ShoppingList {
  items: ShoppingItem[];
  total: number;
  colors: number;
  /** 所有色号包数之和（按色分别取整后相加，与「总粒数 ÷ 每包」不同，这才是实际要买的） */
  packs: number;
  beadsPerPack: number;
}

export function buildShoppingList(
  stats: readonly PatternStatsItem[],
  beadsPerPack: number = DEFAULT_BEADS_PER_PACK,
): ShoppingList {
  const perPack = Number.isFinite(beadsPerPack) && beadsPerPack >= 1 ? Math.floor(beadsPerPack) : DEFAULT_BEADS_PER_PACK;
  let total = 0;
  for (const item of stats) total += item.count;
  const items = [...stats]
    .sort((a, b) => (b.count - a.count) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((item) => ({
      code: item.code,
      hex: item.hex,
      count: item.count,
      share: total > 0 ? Math.round((item.count / total) * 1000) / 10 : 0,
      packs: Math.ceil(item.count / perPack),
    }));
  return {
    items,
    total,
    colors: items.length,
    packs: items.reduce((sum, item) => sum + item.packs, 0),
    beadsPerPack: perPack,
  };
}

/**
 * 纯文本清单：用于「复制」按钮，可直接粘进聊天窗口发给店家。
 * 刻意用「色号 ×粒数」这种一眼能核对的格式，不用表格符号（微信里会错位）。
 */
export function shoppingListText(
  list: ShoppingList,
  options: { designName?: string; width?: number; height?: number } = {},
): string {
  const header = options.designName?.trim()
    ? `${options.designName.trim()}（${options.width ?? '?'} × ${options.height ?? '?'} 格）`
    : '拼豆采购清单';
  const lines = [
    header,
    `共 ${list.total} 粒 · ${list.colors} 色 · 按每包 ${list.beadsPerPack} 粒算需 ${list.packs} 包`,
    '',
    ...list.items.map((item) => `${item.code} ×${item.count}（${item.share}%，${item.packs} 包）`),
  ];
  return lines.join('\n');
}
