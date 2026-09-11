/** 图纸 Canvas 绘制（spec §F7 渲染规则）：色块、网格、板缝线、色号标注、外部格浅灰。 */
import type { Pattern } from '@/lib/types';
import { boardSeamPositions, contrastColor, labelVisible } from './layout';

export interface DrawOptions {
  cellPx: number;
  /** 当前制作规格的一块板边长；缺省保持兼容规格。 */
  boardSize?: number;
  showGrid: boolean;
  showSeams: boolean;
  showLabels: boolean;
  /** 外部格预览色（默认浅灰） */
  externalColor?: string;
  /**
   * cells：只填色（可单独一帧）；overlay：只网格/板缝/色号，不清画布；
   * all：一次画完。大图纸把填色和描线拆开，避免叠成 >50ms 长任务。
   */
  phase?: 'all' | 'cells' | 'overlay';
}

function drawCellsFillRect(ctx: CanvasRenderingContext2D, pattern: Pattern, opts: DrawOptions): void {
  const { width: W, height: H, cells } = pattern;
  const { cellPx } = opts;
  let activeFill = '';
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const cell = cells[y * W + x];
      if (cell.transparent) {
        x++;
        continue;
      }
      const color = cell.external ? (opts.externalColor ?? '#d1d5db') : cell.hex!;
      const start = x++;
      while (x < W) {
        const next = cells[y * W + x];
        const nextColor = next.external ? (opts.externalColor ?? '#d1d5db') : next.hex;
        if (next.transparent || nextColor !== color) break;
        x++;
      }
      if (activeFill !== color) {
        ctx.fillStyle = color;
        activeFill = color;
      }
      ctx.fillRect(start * cellPx, y * cellPx, (x - start) * cellPx, cellPx);
    }
  }
}

function parseHexRgb(hex: string): [number, number, number] | null {
  if (hex.length === 7 && hex.charCodeAt(0) === 35) {
    const n = Number.parseInt(hex.slice(1), 16);
    if (Number.isFinite(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return null;
}

function drawCellsImageData(ctx: CanvasRenderingContext2D, pattern: Pattern, opts: DrawOptions): void {
  const { width: W, height: H, cells } = pattern;
  const { cellPx } = opts;
  if (typeof document === 'undefined' || typeof ImageData === 'undefined') {
    drawCellsFillRect(ctx, pattern, opts);
    return;
  }
  const bitmap = document.createElement('canvas');
  bitmap.width = W;
  bitmap.height = H;
  const off = bitmap.getContext('2d');
  if (!off) {
    drawCellsFillRect(ctx, pattern, opts);
    return;
  }
  const image = new ImageData(W, H);
  const data = image.data;
  const parsed = new Map<string, [number, number, number]>();
  const external = opts.externalColor ?? '#d1d5db';
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index];
    if (cell.transparent) continue;
    const color = cell.external ? external : cell.hex!;
    let rgb = parsed.get(color);
    if (!rgb) {
      rgb = parseHexRgb(color) ?? [209, 213, 219];
      parsed.set(color, rgb);
    }
    const offset = index * 4;
    data[offset] = rgb[0];
    data[offset + 1] = rgb[1];
    data[offset + 2] = rgb[2];
    data[offset + 3] = 255;
  }
  off.putImageData(image, 0, 0);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0, W * cellPx, H * cellPx);
  ctx.imageSmoothingEnabled = smooth;
}

export function drawPattern(ctx: CanvasRenderingContext2D, pattern: Pattern, opts: DrawOptions): void {
  const { width: W, height: H, cells } = pattern;
  const { cellPx } = opts;
  const phase = opts.phase ?? 'all';
  const totalW = W * cellPx;
  const totalH = H * cellPx;
  if (phase !== 'overlay') {
    ctx.clearRect(0, 0, totalW, totalH);

    // 大图纸改走 1px/格的 ImageData 再放大：1 万次 fillRect 在 Retina 画布上会超过 50ms。
    // 小图纸仍用行程合并 fillRect，单测按调用次数锁住像素边界。
    if (W * H >= 2_500) drawCellsImageData(ctx, pattern, opts);
    else drawCellsFillRect(ctx, pattern, opts);
  }
  if (phase === 'cells') return;

  // 网格线
  if (opts.showGrid) {
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x++) {
      ctx.moveTo(x * cellPx + 0.5, 0);
      ctx.lineTo(x * cellPx + 0.5, totalH);
    }
    for (let y = 0; y <= H; y++) {
      ctx.moveTo(0, y * cellPx + 0.5);
      ctx.lineTo(totalW, y * cellPx + 0.5);
    }
    ctx.stroke();
  }

  // 板缝线（间距由当前制作规格决定）
  if (opts.showSeams) {
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = Math.max(2, Math.round(cellPx / 8));
    ctx.beginPath();
    for (const p of boardSeamPositions(W, opts.boardSize)) {
      ctx.moveTo(p * cellPx, 0);
      ctx.lineTo(p * cellPx, totalH);
    }
    for (const p of boardSeamPositions(H, opts.boardSize)) {
      ctx.moveTo(0, p * cellPx);
      ctx.lineTo(totalW, p * cellPx);
    }
    ctx.stroke();
  }

  // 色号标注（格 ≥12px）
  if (opts.showLabels && labelVisible(cellPx)) {
    ctx.font = `${Math.max(8, Math.floor(cellPx * 0.42))}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const cell = cells[y * W + x];
        if (cell.transparent || cell.external || cell.code === null || cell.code === undefined) continue;
        ctx.fillStyle = contrastColor(cell.hex!);
        ctx.fillText(cell.code, x * cellPx + cellPx / 2, y * cellPx + cellPx / 2);
      }
    }
  }
}
