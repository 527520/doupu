import { describe, expect, it } from 'vitest';
import {
  applyBrush,
  applyErase,
  applyTransform,
  brushBounds,
  clearAll,
  floodFill,
  makeSolid,
  makeTransparent,
  replaceByCode,
  sameCell,
} from './ops';
import type { PaletteColor, PatternCell } from '@/lib/types';

const RED: PaletteColor = { hex: '#FF0000', code: 'A' };
const BLUE: PaletteColor = { hex: '#0000FF', code: 'B' };
const GREEN: PaletteColor = { hex: '#00FF00', code: 'C' };

function grid(W: number, H: number, fill: (r: number, c: number) => PatternCell): PatternCell[] {
  const cells: PatternCell[] = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) cells.push(fill(r, c));
  return cells;
}

const solidGrid = (W: number, H: number, color: PaletteColor = RED) => grid(W, H, () => makeSolid(color.hex, color.code));

describe('applyTransform（优化票 09：镜像/旋转）', () => {
  /** 每格 code 记作 "x,y"（x=列, y=行），便于验证坐标映射。 */
  const labeled = (W: number, H: number): PatternCell[] =>
    Array.from({ length: W * H }, (_, i) => makeSolid('#112233', `${i % W},${Math.floor(i / W)}`));
  const codeAt = (cells: PatternCell[], W: number, x: number, y: number) => cells[y * W + x].code;

  it('mirrorH：左右互换，尺寸不变，入参不被修改', () => {
    const src = labeled(2, 3);
    const r = applyTransform(src, 2, 3, 'mirrorH');
    expect(r.width).toBe(2);
    expect(r.height).toBe(3);
    expect(codeAt(r.cells, 2, 1, 0)).toBe('0,0');
    expect(codeAt(r.cells, 2, 0, 0)).toBe('1,0');
    expect(codeAt(r.cells, 2, 1, 2)).toBe('0,2');
    expect(codeAt(src, 2, 0, 0)).toBe('0,0'); // 入参不变
  });

  it('mirrorV：上下互换，尺寸不变', () => {
    const r = applyTransform(labeled(2, 3), 2, 3, 'mirrorV');
    expect(r.width).toBe(2);
    expect(r.height).toBe(3);
    expect(codeAt(r.cells, 2, 0, 0)).toBe('0,2');
    expect(codeAt(r.cells, 2, 1, 1)).toBe('1,1');
  });

  it('rotateCW：90° 顺转，宽高互换（2×3 → 3×2），坐标映射正确', () => {
    const r = applyTransform(labeled(2, 3), 2, 3, 'rotateCW');
    expect(r.width).toBe(3);
    expect(r.height).toBe(2);
    // 原 (x,y) → 新 (H-1-y, x)
    expect(codeAt(r.cells, 3, 2, 0)).toBe('0,0');
    expect(codeAt(r.cells, 3, 0, 0)).toBe('0,2');
    expect(codeAt(r.cells, 3, 1, 1)).toBe('1,1');
  });

  it('rotateCCW 与 rotateCW 互逆；旋转四次回到原样', () => {
    const src = labeled(2, 3);
    const cw = applyTransform(src, 2, 3, 'rotateCW');
    const back = applyTransform(cw.cells, cw.width, cw.height, 'rotateCCW');
    expect(back.width).toBe(2);
    expect(back.height).toBe(3);
    for (let i = 0; i < back.cells.length; i++) {
      expect(back.cells[i].code).toBe(src[i].code);
    }
    let four = applyTransform(src, 2, 3, 'rotateCW');
    for (let i = 0; i < 3; i++) {
      four = applyTransform(four.cells, four.width, four.height, 'rotateCW');
    }
    expect(four.width).toBe(2);
    expect(four.height).toBe(3);
    for (let i = 0; i < four.cells.length; i++) {
      expect(four.cells[i].code).toBe(src[i].code);
    }
  });

  it('透明/外部标志随格迁移（旋转 2×2）', () => {
    const src = labeled(2, 2);
    src[0] = makeTransparent(); // 原(0,0)
    src[1] = { ...src[1], external: true }; // 原(1,0)
    const r = applyTransform(src, 2, 2, 'rotateCW');
    // 原(0,0) → 新(1,0) → index 1；原(1,0) → 新(1,1) → index 3
    expect(r.cells[1].transparent).toBe(true);
    expect(r.cells[3].external).toBe(true);
  });
});

describe('brushBounds', () => {
  it('居中且钳制边界（含 1×1 图纸）', () => {
    expect(brushBounds(0, 0, 3, 10, 10)).toEqual({ r0: 0, r1: 3, c0: 0, c1: 3 });
    expect(brushBounds(9, 9, 3, 10, 10)).toEqual({ r0: 8, r1: 10, c0: 8, c1: 10 });
    expect(brushBounds(0, 0, 1, 1, 1)).toEqual({ r0: 0, r1: 1, c0: 0, c1: 1 });
    expect(brushBounds(5, 5, 2, 10, 10)).toEqual({ r0: 5, r1: 7, c0: 5, c1: 7 });
    expect(brushBounds(0, 5, 2, 10, 10)).toEqual({ r0: 0, r1: 2, c0: 5, c1: 7 });
  });
});

describe('applyBrush / applyErase', () => {
  it('画笔覆盖 3×3 中心区域且快照只含变化格', () => {
    const cells = solidGrid(5, 5, BLUE);
    const snaps = applyBrush(cells, 5, 5, 2, 2, 3, RED);
    expect(snaps).toHaveLength(9);
    expect(cells.filter((c) => c.hex === RED.hex)).toHaveLength(9);
    expect(cells.filter((c) => c.hex === BLUE.hex)).toHaveLength(16);
    // 已为目标色的格不产生快照（重复涂抹幂等）
    const again = applyBrush(cells, 5, 5, 2, 2, 3, RED);
    expect(again).toHaveLength(0);
  });

  it('画笔清除 external 标记（编辑使外部格变实体）', () => {
    const cells = grid(2, 2, () => ({ hex: BLUE.hex, code: BLUE.code, transparent: false, external: true }));
    applyBrush(cells, 2, 2, 0, 0, 1, RED);
    expect(cells[0]).toEqual({ hex: RED.hex, code: RED.code, transparent: false });
  });

  it('橡皮置透明并跳过已透明格', () => {
    const cells = grid(3, 1, (_, c) => (c === 1 ? makeTransparent() : makeSolid(RED.hex, RED.code)));
    const snaps = applyErase(cells, 3, 1, 0, 1, 3);
    expect(snaps).toHaveLength(2); // 中间透明格跳过
    expect(cells.every((c) => c.transparent)).toBe(true);
  });
});

describe('floodFill（E22）', () => {
  it('仅填充同色连通区域，不越过异色边界', () => {
    // 3×3：左列红、右列蓝、中列红 —— 左右红区被蓝列隔断
    const cells = grid(3, 3, (r, c) => (c === 1 ? makeSolid(BLUE.hex, BLUE.code) : makeSolid(RED.hex, RED.code)));
    const snaps = floodFill(cells, 3, 3, 1, 0, GREEN);
    expect(snaps).toHaveLength(3); // 左列 3 格
    expect(cells.filter((c) => c.hex === GREEN.hex)).toHaveLength(3);
    expect(cells.filter((c) => c.hex === RED.hex)).toHaveLength(3); // 右列保持红
    expect(cells.filter((c) => c.hex === BLUE.hex)).toHaveLength(3);
  });

  it('透明区域连通填充（打洞后补色）', () => {
    const cells = grid(2, 2, () => makeTransparent());
    cells[3] = makeSolid(RED.hex, RED.code);
    const snaps = floodFill(cells, 2, 2, 0, 0, BLUE);
    expect(snaps).toHaveLength(3);
    expect(cells.slice(0, 3).every((c) => c.hex === BLUE.hex)).toBe(true);
    expect(cells[3].hex).toBe(RED.hex);
  });

  it('起点已与目标一致 → 空快照（幂等）', () => {
    const cells = solidGrid(3, 3, RED);
    expect(floodFill(cells, 3, 3, 1, 1, RED)).toHaveLength(0);
    const transparent = grid(2, 2, () => makeTransparent());
    expect(floodFill(transparent, 2, 2, 0, 0, null)).toHaveLength(0);
  });

  it('target=null 橡皮填充', () => {
    const cells = solidGrid(3, 3, RED);
    const snaps = floodFill(cells, 3, 3, 1, 1, null);
    expect(snaps).toHaveLength(9);
    expect(cells.every((c) => c.transparent)).toBe(true);
  });

  it('200×200 全图填充性能（预算 50ms；阈值放宽至 200ms 防负载抖动，规格预算由引擎级测试守护）', () => {
    const cells = solidGrid(200, 200, RED);
    const start = performance.now();
    const snaps = floodFill(cells, 200, 200, 0, 0, BLUE);
    const elapsed = performance.now() - start;
    expect(snaps).toHaveLength(40000);
    expect(elapsed).toBeLessThan(200);
  });
});

describe('replaceByCode（E23）', () => {
  it('按色号替换；同色号不同 hex 全部命中', () => {
    // code A 出现两次（不同 hex），code B 一次
    const cells = grid(3, 1, (_, c) =>
      c === 2 ? makeSolid(BLUE.hex, BLUE.code) : makeSolid(c === 0 ? RED.hex : '#AA0000', RED.code),
    );
    const snaps = replaceByCode(cells, 'A', GREEN);
    expect(snaps).toHaveLength(2);
    expect(cells.slice(0, 2).every((c) => c.hex === GREEN.hex && c.code === GREEN.code)).toBe(true);
    expect(cells[2].hex).toBe(BLUE.hex);
  });

  it('幂等：替换为同一颜色零快照；不存在色号零快照', () => {
    const cells = solidGrid(3, 3, RED);
    expect(replaceByCode(cells, 'A', RED)).toHaveLength(0);
    expect(replaceByCode(cells, 'ZZZ', BLUE)).toHaveLength(0);
  });

  it('排除颜色：target=null 置透明；透明格不参与', () => {
    const cells = grid(3, 1, (_, c) => (c === 1 ? makeTransparent() : makeSolid(RED.hex, RED.code)));
    const snaps = replaceByCode(cells, 'A', null);
    expect(snaps).toHaveLength(2);
    expect(cells.every((c) => c.transparent)).toBe(true);
  });
});

describe('clearAll / sameCell', () => {
  it('清空全部非透明格', () => {
    const cells = grid(3, 2, (r, c) => (r === 0 && c === 0 ? makeTransparent() : makeSolid(RED.hex, RED.code)));
    const snaps = clearAll(cells);
    expect(snaps).toHaveLength(5);
    expect(cells.every((c) => c.transparent)).toBe(true);
  });

  it('sameCell 比较 hex/code/transparent/external', () => {
    const a = makeSolid(RED.hex, RED.code);
    expect(sameCell(a, { ...a })).toBe(true);
    expect(sameCell(a, { ...a, external: true })).toBe(false);
    expect(sameCell(a, makeTransparent())).toBe(false);
    expect(sameCell(a, makeSolid(RED.hex, null))).toBe(false);
  });
});

describe('编辑器核心操作性能（优化票 12：200×200 单操作，设计预算 <50ms；阈值放宽至 200ms 防负载抖动，与既有口径一致）', () => {
  const W = 200;
  const H = 200;

  it('applyBrush：最大笔刷 200×200 中心', () => {
    const cells = solidGrid(W, H);
    const start = performance.now();
    const snaps = applyBrush(cells, W, H, 100, 100, 3, BLUE);
    const elapsed = performance.now() - start;
    expect(snaps).toHaveLength(9);
    expect(elapsed).toBeLessThan(200);
  });

  it('floodFill：全连通 40000 格区域', () => {
    const cells = solidGrid(W, H);
    const start = performance.now();
    const snaps = floodFill(cells, W, H, 0, 0, BLUE);
    const elapsed = performance.now() - start;
    expect(snaps).toHaveLength(W * H);
    expect(cells.every((c) => c.hex === BLUE.hex)).toBe(true);
    expect(elapsed).toBeLessThan(200);
  });

  it('clearAll：200×200 全图清除', () => {
    const cells = solidGrid(W, H);
    const start = performance.now();
    const snaps = clearAll(cells);
    const elapsed = performance.now() - start;
    expect(snaps).toHaveLength(W * H);
    expect(elapsed).toBeLessThan(200);
  });
});
