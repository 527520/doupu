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
type DragMode = 'create' | 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br';

/** 展示宽度上限（CSS px），大图等比缩小，小图按原尺寸显示。 */
const MAX_DISPLAY_WIDTH = 800;
/** 手柄视觉尺寸 / 命中热区尺寸（CSS px，热区更大便于鼠标与触屏）。 */
const HANDLE_VISUAL = 8;
const HANDLE_HIT = 20;

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
    // 关键：显式 CSS 尺寸，防止父容器（grid/flex）把画布拉伸导致坐标错乱
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
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

    // 四角手柄（视觉 8px）
    ctx.fillStyle = '#3b82f6';
    for (const [hx, hy] of [
      [rx, ry],
      [rx + rw, ry],
      [rx, ry + rh],
      [rx + rw, ry + rh],
    ]) {
      ctx.fillRect(hx - HANDLE_VISUAL / 2, hy - HANDLE_VISUAL / 2, HANDLE_VISUAL, HANDLE_VISUAL);
    }
  }, [image, rect, scale, displayWidth, displayHeight, sourceCanvas]);

  /** 客户区坐标 → 图像像素坐标（按画布真实渲染尺寸换算，与 CSS 拉伸无关）。 */
  const toImageCoords = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return { x: 0, y: 0 };
      return {
        x: ((clientX - bounds.left) / bounds.width) * image.width,
        y: ((clientY - bounds.top) / bounds.height) * image.height,
      };
    },
    [image.width, image.height],
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

      // 命中半径按画布真实渲染比例换算成图像像素
      const bounds = canvas.getBoundingClientRect();
      const hitX = (HANDLE_HIT / Math.max(bounds.width, 1)) * image.width;
      const hitY = (HANDLE_HIT / Math.max(bounds.height, 1)) * image.height;
      const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(hitX, hitY);

      let mode: DragMode;
      if (near(p.x, current.x) && near(p.y, current.y)) mode = 'resize-tl';
      else if (near(p.x, current.x + current.width) && near(p.y, current.y)) mode = 'resize-tr';
      else if (near(p.x, current.x) && near(p.y, current.y + current.height)) mode = 'resize-bl';
      else if (near(p.x, current.x + current.width) && near(p.y, current.y + current.height)) mode = 'resize-br';
      else if (p.x >= current.x && p.x <= current.x + current.width && p.y >= current.y && p.y <= current.y + current.height) {
        mode = 'move';
      } else {
        mode = 'create'; // 框外按下：拖拽框选新选区
      }

      const drag = {
        mode,
        startPointer: p,
        startRect: current,
      };

      /** 由指针位置计算选区（move/resize/create 共用；pointerup 时以此收敛最终值）。 */
      const nextRectFor = (q: { x: number; y: number }): Rect => {
        const dx = q.x - drag.startPointer.x;
        const dy = q.y - drag.startPointer.y;
        if (drag.mode === 'create') {
          // 拖拽框选：起点到当前点围成矩形
          const raw: Rect = {
            x: Math.min(drag.startPointer.x, q.x),
            y: Math.min(drag.startPointer.y, q.y),
            width: Math.abs(dx),
            height: Math.abs(dy),
          };
          const ratio = ratioFor(ratioMode);
          if (ratio !== null && raw.width > 0 && raw.height > 0) {
            // 比例锁定：按拖拽方向选择锚点，保证从起点方向伸展
            const anchor: AspectAnchor =
              dx < 0 && dy < 0
                ? 'bottom-right'
                : dx < 0
                  ? 'top-right'
                  : dy < 0
                    ? 'bottom-left'
                    : 'top-left';
            return applyAspectLock(raw, ratio, anchor);
          }
          return raw;
        }
        if (drag.mode === 'move') {
          return { x: drag.startRect.x + dx, y: drag.startRect.y + dy, width: drag.startRect.width, height: drag.startRect.height };
        }
        const anchor: AspectAnchor =
          drag.mode === 'resize-tl'
            ? 'bottom-right'
            : drag.mode === 'resize-tr'
              ? 'bottom-left'
              : drag.mode === 'resize-bl'
                ? 'top-right'
                : 'top-left';
        const moved = moveCorner(drag.startRect, drag.mode, q);
        return ratioFor(ratioMode) !== null ? applyAspectLock(moved, ratioFor(ratioMode)!, anchor) : moved;
      };

      const onMove = (ev: PointerEvent) => {
        const q = toImageCoords(ev.clientX, ev.clientY);
        setRect(clampCropRect(nextRectFor(q), image.width, image.height));
      };

      const onUp = (ev: PointerEvent) => {
        // pointerup 位置是权威终点：以它收敛最终选区（部分浏览器会合并中间 pointermove，
        // 只依赖 move 事件可能丢掉最后一小段拖动）。
        const q = toImageCoords(ev.clientX, ev.clientY);
        const isClick =
          drag.mode === 'create' && Math.abs(q.x - drag.startPointer.x) < 2 && Math.abs(q.y - drag.startPointer.y) < 2;
        if (isClick) {
          // 单击：在点击处创建最小选区
          setRect(
            clampCropRect(
              { x: drag.startPointer.x, y: drag.startPointer.y, width: MIN_CROP_SIZE, height: MIN_CROP_SIZE },
              image.width,
              image.height,
            ),
          );
        } else {
          setRect(clampCropRect(nextRectFor(q), image.width, image.height));
        }
        canvas.removeEventListener('pointermove', onMove as unknown as EventListener);
        canvas.removeEventListener('pointerup', onUp as unknown as EventListener);
      };

      canvas.addEventListener('pointermove', onMove as unknown as EventListener);
      canvas.addEventListener('pointerup', onUp as unknown as EventListener);
    },
    [rect, image.width, image.height, ratioMode, ratioFor, toImageCoords],
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
        // 首帧即按展示尺寸布局（displayWidth 在渲染期已知）：
        // 若等绘制 effect 再设置，画布会先以 300×150 默认尺寸闪现一帧，
        // 期间命中检测与坐标换算都会错位（WebKit 实测偶发）。
        width={displayWidth}
        height={displayHeight}
        style={{ width: displayWidth, height: displayHeight }}
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
function moveCorner(rect: Rect, mode: Exclude<DragMode, 'move' | 'create'>, p: { x: number; y: number }): Rect {
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
