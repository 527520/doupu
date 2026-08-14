'use client';

/**
 * 图片裁剪组件（spec §F2）：自由/1:1/原始比例框选，四角缩放 + 内部拖动 + 键盘微调。
 * 像素读取直接使用 DecodedImage 的 RGBA 缓冲（不调用 getImageData），
 * 全部矩形几何经 src/lib/crop/layout.ts 纯函数处理。
 * 说明：自研实现（未采用 react-cropper：其 React 19 peer 依赖不兼容）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { zhCN } from '@/messages/zh-CN';
import {
  applyAspectLock,
  clampCropRect,
  MIN_CROP_SIZE,
  type AspectAnchor,
  type Rect,
} from '@/lib/crop/layout';
import type { DecodedImage } from '@/lib/image/decode';

export interface ImageCropperProps {
  image: DecodedImage;
  initialRect?: Rect;
  onConfirm: (rect: Rect) => void;
  onCancel: () => void;
}

type RatioMode = 'free' | 'square' | 'original';
type DragMode = 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br';

/** 展示宽度上限（CSS px），大图等比缩小，小图按原尺寸显示。 */
const MAX_DISPLAY_WIDTH = 800;
const HANDLE_RADIUS = 8;

export function ImageCropper({ image, initialRect, onConfirm, onCancel }: ImageCropperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rect, setRect] = useState<Rect>(() =>
    clampCropRect(initialRect ?? { x: 0, y: 0, width: image.width, height: image.height }, image.width, image.height),
  );
  const [ratioMode, setRatioMode] = useState<RatioMode>('free');

  const displayWidth = Math.min(image.width, MAX_DISPLAY_WIDTH);
  const displayHeight = Math.round((displayWidth * image.height) / image.width);
  const scale = displayWidth / image.width;

  /** 自然尺寸的像素画布（从 DecodedImage 的 RGBA 缓冲直接构建，避免 getImageData）。 */
  const sourceCanvas = useMemo(() => {
    if (typeof ImageData === 'undefined' || typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
    return canvas;
  }, [image]);

  /** 重绘：源图 + 选框遮罩 + 四角手柄。 */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    canvas.width = Math.round(displayWidth * dpr);
    canvas.height = Math.round(displayHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayWidth, displayHeight);
    if (sourceCanvas) ctx.drawImage(sourceCanvas, 0, 0, displayWidth, displayHeight);

    const r = clampCropRect(rect, image.width, image.height);
    const rx = r.x * scale;
    const ry = r.y * scale;
    const rw = r.width * scale;
    const rh = r.height * scale;

    // 选框外暗化
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, displayWidth, ry);
    ctx.fillRect(0, ry + rh, displayWidth, displayHeight - ry - rh);
    ctx.fillRect(0, ry, rx, rh);
    ctx.fillRect(rx + rw, ry, displayWidth - rx - rw, rh);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);

    // 四角手柄
    ctx.fillStyle = '#3b82f6';
    for (const [hx, hy] of [
      [rx, ry],
      [rx + rw, ry],
      [rx, ry + rh],
      [rx + rw, ry + rh],
    ]) {
      ctx.fillRect(hx - HANDLE_RADIUS / 2, hy - HANDLE_RADIUS / 2, HANDLE_RADIUS, HANDLE_RADIUS);
    }
  }, [image, rect, scale, displayWidth, displayHeight, sourceCanvas]);

  /** 客户区坐标 → 图像像素坐标。 */
  const toImageCoords = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const bounds = canvas.getBoundingClientRect();
      return {
        x: (clientX - bounds.left) / scale,
        y: (clientY - bounds.top) / scale,
      };
    },
    [scale],
  );

  const ratioFor = useCallback((mode: RatioMode): number | null => {
    if (mode === 'square') return 1;
    if (mode === 'original') return image.width / image.height;
    return null;
  }, [image.width, image.height]);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);

      const current = clampCropRect(rect, image.width, image.height);
      const p = toImageCoords(event.clientX, event.clientY);

      const radius = HANDLE_RADIUS / scale;
      const near = (a: number, b: number) => Math.abs(a - b) <= radius;
      let mode: DragMode;
      if (near(p.x, current.x) && near(p.y, current.y)) mode = 'resize-tl';
      else if (near(p.x, current.x + current.width) && near(p.y, current.y)) mode = 'resize-tr';
      else if (near(p.x, current.x) && near(p.y, current.y + current.height)) mode = 'resize-bl';
      else if (near(p.x, current.x + current.width) && near(p.y, current.y + current.height)) mode = 'resize-br';
      else if (p.x >= current.x && p.x <= current.x + current.width && p.y >= current.y && p.y <= current.y + current.height) {
        mode = 'move';
      } else {
        // 点选框外：以点击点新建最小选区
        setRect(clampCropRect({ x: p.x, y: p.y, width: MIN_CROP_SIZE, height: MIN_CROP_SIZE }, image.width, image.height));
        return;
      }

      const drag = {
        mode,
        startPointer: p,
        startRect: current,
      };

      const onMove = (ev: PointerEvent) => {
        const q = toImageCoords(ev.clientX, ev.clientY);
        const dx = q.x - drag.startPointer.x;
        const dy = q.y - drag.startPointer.y;
        let next: Rect;
        if (drag.mode === 'move') {
          next = { x: drag.startRect.x + dx, y: drag.startRect.y + dy, width: drag.startRect.width, height: drag.startRect.height };
        } else {
          const anchor: AspectAnchor =
            drag.mode === 'resize-tl'
              ? 'bottom-right'
              : drag.mode === 'resize-tr'
                ? 'bottom-left'
                : drag.mode === 'resize-bl'
                  ? 'top-right'
                  : 'top-left';
          const moved = moveCorner(drag.startRect, drag.mode, q);
          next = ratioFor(ratioMode) !== null ? applyAspectLock(moved, ratioFor(ratioMode)!, anchor) : moved;
        }
        setRect(clampCropRect(next, image.width, image.height));
      };

      const onUp = () => {
        canvas.removeEventListener('pointermove', onMove as unknown as EventListener);
        canvas.removeEventListener('pointerup', onUp as unknown as EventListener);
      };

      canvas.addEventListener('pointermove', onMove as unknown as EventListener);
      canvas.addEventListener('pointerup', onUp as unknown as EventListener);
    },
    [rect, image.width, image.height, scale, ratioMode, ratioFor, toImageCoords],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLCanvasElement>) => {
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const deltas: Record<string, { x: number; y: number }> = {
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step },
        ArrowDown: { x: 0, y: step },
      };
      const delta = deltas[event.key]!;
      setRect((prev) => clampCropRect({ ...prev, x: prev.x + delta.x, y: prev.y + delta.y }, image.width, image.height));
    },
    [image.width, image.height],
  );

  const changeRatioMode = useCallback(
    (mode: RatioMode) => {
      setRatioMode(mode);
      const ratio = ratioFor(mode);
      if (ratio !== null) {
        setRect((prev) => clampCropRect(applyAspectLock(prev, ratio, 'center'), image.width, image.height));
      }
    },
    [ratioFor, image.width, image.height],
  );

  const confirm = useCallback(() => {
    onConfirm(clampCropRect(rect, image.width, image.height));
  }, [rect, image.width, image.height, onConfirm]);

  const { crop } = zhCN;
  const current = clampCropRect(rect, image.width, image.height);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{crop.title}</h2>
        <div role="group" aria-label={crop.ariaRatioMode} className="flex gap-1 rounded border border-gray-300 p-1 text-sm">
          {(
            [
              ['free', crop.modeFree],
              ['square', crop.modeSquare],
              ['original', crop.modeOriginal],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={ratioMode === mode}
              onClick={() => changeRatioMode(mode)}
              className={[
                'rounded px-2 py-1',
                ratioMode === mode ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label={crop.ariaCropCanvas}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        className="max-w-full cursor-crosshair rounded outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
        <p>{crop.sizeLabel(current.width, current.height)}</p>
        <p className="hidden text-xs text-gray-400 sm:block">
          {crop.dragHint}；{crop.nudgeHint}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
        >
          {crop.cancel}
        </button>
        <button
          type="button"
          onClick={() => onConfirm({ x: 0, y: 0, width: image.width, height: image.height })}
          className="rounded border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
        >
          {crop.useWholeImage}
        </button>
        <button
          type="button"
          onClick={confirm}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          {crop.confirm}
        </button>
      </div>
    </div>
  );
}

/** 按拖拽的角更新矩形（对角固定）。 */
function moveCorner(rect: Rect, mode: Exclude<DragMode, 'move'>, p: { x: number; y: number }): Rect {
  switch (mode) {
    case 'resize-tl':
      return { x: p.x, y: p.y, width: rect.x + rect.width - p.x, height: rect.y + rect.height - p.y };
    case 'resize-tr':
      return { x: rect.x, y: p.y, width: p.x - rect.x, height: rect.y + rect.height - p.y };
    case 'resize-bl':
      return { x: p.x, y: rect.y, width: rect.x + rect.width - p.x, height: p.y - rect.y };
    case 'resize-br':
      return { x: rect.x, y: rect.y, width: p.x - rect.x, height: p.y - rect.y };
  }
}
