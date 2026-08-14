/** 图纸 Canvas 绘制（spec §F7 渲染规则）：色块、网格、板缝线、色号标注、外部格浅灰。 */
import type { Pattern } from '@/lib/types';
import { boardSeamPositions, contrastColor, labelVisible } from './layout';

export interface DrawOptions {
  cellPx: number;
  showGrid: boolean;
  showSeams: boolean;
  showLabels: boolean;
  /** 外部格预览色（默认浅灰） */
  externalColor?: string;
}

export function drawPattern(ctx: CanvasRenderingContext2D, pattern: Pattern, opts: DrawOptions): void {
  const { width: W, height: H, cells } = pattern;
  const { cellPx } = opts;
  const totalW = W * cellPx;
  const totalH = H * cellPx;
  ctx.clearRect(0, 0, totalW, totalH);

  // 色块
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = cells[y * W + x];
      if (cell.transparent) continue;
      ctx.fillStyle = cell.external ? (opts.externalColor ?? '#d1d5db') : cell.hex!;
      ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
    }
  }

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

  // 板缝线（每 29 格）
  if (opts.showSeams) {
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = Math.max(2, Math.round(cellPx / 8));
    ctx.beginPath();
    for (const p of boardSeamPositions(W)) {
      ctx.moveTo(p * cellPx, 0);
      ctx.lineTo(p * cellPx, totalH);
    }
    for (const p of boardSeamPositions(H)) {
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
