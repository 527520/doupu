'use client';

import type { Pattern } from '@/lib/types';
import { contrastColor } from '@/lib/render/layout';
import { zhCN } from '@/messages/zh-CN';

export interface LoupeTarget {
  row: number;
  col: number;
  x: number;
  y: number;
}

interface Props {
  pattern: Pattern;
  target: LoupeTarget | null;
  viewportWidth: number;
  viewportHeight: number;
  done?: Uint8Array;
}

const RADIUS = 3;
const LOUPE_HALF_WIDTH = 82;
const LOUPE_HEIGHT = 190;

export default function FingerLoupe({ pattern, target, viewportWidth, viewportHeight, done }: Props) {
  if (!target) return null;
  const t = zhCN.canvas;
  const cell = pattern.cells[target.row * pattern.width + target.col];
  const label = cell?.transparent
    ? t.empty
    : (cell?.code ?? cell?.hex ?? t.unavailable);
  const isDone = done?.[target.row * pattern.width + target.col] === 1;
  const progress = done ? (isDone ? t.done : t.pending) : undefined;
  const left = Math.max(LOUPE_HALF_WIDTH, Math.min(viewportWidth - LOUPE_HALF_WIDTH, target.x));
  const placeBelow = target.y < LOUPE_HEIGHT + 34;
  const top = placeBelow
    ? Math.min(viewportHeight - LOUPE_HEIGHT - 8, target.y + 28)
    : target.y - LOUPE_HEIGHT - 22;

  const cells = [];
  for (let rowOffset = -RADIUS; rowOffset <= RADIUS; rowOffset += 1) {
    for (let colOffset = -RADIUS; colOffset <= RADIUS; colOffset += 1) {
      const row = target.row + rowOffset;
      const col = target.col + colOffset;
      const current = row >= 0 && row < pattern.height && col >= 0 && col < pattern.width
        ? pattern.cells[row * pattern.width + col]
        : null;
      const center = rowOffset === 0 && colOffset === 0;
      const color = current?.hex ?? 'var(--color-canvas-unavailable)';
      cells.push(
        <span
          key={`${rowOffset}:${colOffset}`}
          className={`finger-loupe-cell${center ? ' is-center' : ''}${current?.transparent ? ' is-empty' : ''}`}
          style={{ backgroundColor: color, color: current?.hex ? contrastColor(current.hex) : 'var(--color-ink-soft)' }}
        >
          {current?.transparent ? '·' : (current?.code ?? '')}
        </span>,
      );
    }
  }

  return (
    <div
      className="finger-loupe"
      style={{ left, top: Math.max(8, top) }}
      role="status"
      aria-label={t.loupeAria(target.row + 1, target.col + 1, label, progress)}
    >
      <div className="finger-loupe-grid" aria-hidden="true">{cells}</div>
      <p>
        <strong>{t.coordinate(target.row + 1, target.col + 1)}</strong>
        <span>{label}{progress ? ` · ${progress}` : ''}</span>
      </p>
    </div>
  );
}
