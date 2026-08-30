'use client';

import Icon from '@/components/ui/Icon';
import { zhCN } from '@/messages/zh-CN';

interface Props {
  cellPx: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitBoard: () => void;
  onFitPattern: () => void;
}

export default function GridViewportControls({
  cellPx,
  onZoomOut,
  onZoomIn,
  onFitBoard,
  onFitPattern,
}: Props) {
  const t = zhCN.canvas;
  return (
    <div className="grid-viewport-controls" aria-label={t.zoomControls}>
      <button type="button" onClick={onZoomOut} aria-label={t.zoomOut} title={t.zoomOut}>
        <Icon name="zoom-out" size={18} />
      </button>
      <output aria-label={t.currentCellSize}>{Math.round(cellPx)}px</output>
      <button type="button" onClick={onZoomIn} aria-label={t.zoomIn} title={t.zoomIn}>
        <Icon name="zoom-in" size={18} />
      </button>
      <span aria-hidden="true" />
      <button type="button" onClick={onFitBoard} aria-label={t.fitBoard} title={t.fitBoard}>
        <Icon name="grid" size={17} />
      </button>
      <button type="button" onClick={onFitPattern} aria-label={t.fitPattern} title={t.fitPattern}>
        <Icon name="fit" size={17} />
      </button>
    </div>
  );
}
