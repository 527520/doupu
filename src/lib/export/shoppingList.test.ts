import { describe, expect, it } from 'vitest';
import { DEFAULT_BEADS_PER_PACK, buildShoppingList, shoppingListText } from './shoppingList';
import type { PatternStatsItem } from '@/lib/types';

const stats: PatternStatsItem[] = [
  { code: 'A01', hex: '#FF0000', count: 1200 },
  { code: 'B02', hex: '#00FF00', count: 800 },
  { code: 'C03', hex: '#0000FF', count: 1 },
];

describe('buildShoppingList（F-3）', () => {
  it('按用量降序，给出占比与包数', () => {
    const list = buildShoppingList(stats);
    expect(list.total).toBe(2001);
    expect(list.colors).toBe(3);
    expect(list.beadsPerPack).toBe(DEFAULT_BEADS_PER_PACK);
    expect(list.items.map((item) => item.code)).toEqual(['A01', 'B02', 'C03']);
    expect(list.items[0]).toEqual({ code: 'A01', hex: '#FF0000', count: 1200, share: 60, packs: 2 });
    // 1 粒也要买一包——这正是用户容易漏算的地方
    expect(list.items[2].packs).toBe(1);
  });

  it('总包数是各色分别取整后相加，而不是总粒数除以每包', () => {
    const list = buildShoppingList(stats);
    expect(list.packs).toBe(2 + 1 + 1);
    expect(list.packs).not.toBe(Math.ceil(list.total / list.beadsPerPack));
  });

  it('每包颗数可改；非法值回退默认', () => {
    expect(buildShoppingList(stats, 500).items[0].packs).toBe(3); // 1200 / 500
    expect(buildShoppingList(stats, 0).beadsPerPack).toBe(DEFAULT_BEADS_PER_PACK);
    expect(buildShoppingList(stats, Number.NaN).beadsPerPack).toBe(DEFAULT_BEADS_PER_PACK);
    expect(buildShoppingList(stats, 250.7).beadsPerPack).toBe(250);
  });

  it('同用量按色号排序，保证清单顺序确定', () => {
    const tie: PatternStatsItem[] = [
      { code: 'Z9', hex: '#111111', count: 10 },
      { code: 'A1', hex: '#222222', count: 10 },
    ];
    expect(buildShoppingList(tie).items.map((item) => item.code)).toEqual(['A1', 'Z9']);
  });

  it('空图纸给出空清单而不是崩溃', () => {
    const list = buildShoppingList([]);
    expect(list).toMatchObject({ total: 0, colors: 0, packs: 0 });
    expect(list.items).toEqual([]);
  });
});

describe('shoppingListText（F-3 复制文本）', () => {
  it('含设计名、总量与逐色行，便于直接发给店家', () => {
    const text = shoppingListText(buildShoppingList(stats), { designName: '小熊', width: 50, height: 40 });
    const lines = text.split('\n');
    expect(lines[0]).toBe('小熊（50 × 40 格）');
    expect(lines[1]).toBe('共 2001 粒 · 3 色 · 按每包 1000 粒算需 4 包');
    expect(lines[3]).toBe('A01 ×1200（60%，2 包）');
    expect(lines).toHaveLength(6);
  });

  it('无设计名时用通用标题', () => {
    expect(shoppingListText(buildShoppingList(stats)).split('\n')[0]).toBe('拼豆采购清单');
  });
});
