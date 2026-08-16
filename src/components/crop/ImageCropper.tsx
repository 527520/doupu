'use client';

/**
 * 图片裁剪组件（spec §F2）：自由/1:1/原始比例框选。
 * 交互：四角 + 四边手柄缩放、内部拖动、框外拖拽框选、键盘微调；
 * 移动端：touch-action none 防页面滚动/下拉刷新，触屏手柄热区加大，
 * 指针位置钳制在图像内（拖到边框平滑停靠，不会瞬间跳变）。
 * 展示：容器宽度自适应 + 严格按原图宽高比显示（窄屏不拉伸变形）。
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
  resizeEdge,
  type AspectAnchor,
  type Rect,
  type ResizeEdge,
} from '@/lib/crop/layout';
import type { DecodedImage } from '@/lib/image/decode';

export interface ImageCropperProps {
  image: DecodedImage;
  initialRect?: Rect;
  onConfirm: (rect: Rect) => void;
  onCancel: () => void;
}

type RatioMode = 'free' | 'square' | 'original';
type DragMode =
  | 'create'
  | 'move'
  | 'resize-tl'
  | 'resize-tr'
  | 'resize-bl'
  | 'resize-br'
  | 'resize-top'
  | 'resize-bottom'
  | 'resize-left'
  | 'resize-right';

/** 展示宽度上限（CSS px），大图等比缩小，小图按原尺寸显示。 */
const MAX_DISPLAY_WIDTH = 800;
/** 手柄视觉尺寸（CSS px）。 */
const HANDLE_VISUAL = 8;
const EDGE_HANDLE_VISUAL = 6;
/** 命中热区尺寸（CSS px）：鼠标 / 触屏（热区更大便于手指）。 */
const HANDLE_HIT = 20;
const HANDLE_HIT_TOUCH = 30;

/** 命中检测（纯函数，供拖拽与桌面悬停光标共用）。 */
function hitTestMode(p: { x: number; y: number }, current: Rect, hitX: number, hitY: number): DragMode {
  const nearX = (v: number) => Math.abs(p.x - v) <= hitX;
  const nearY = (v: number) => Math.abs(p.y - v) <= hitY;
  const insideX = p.x >= current.x && p.x <= current.x + current.width;
  const insideY = p.y >= current.y && p.y <= current.y + current.height;

  // 四角优先
  if (nearX(current.x) && nearY(current.y)) return 'resize-tl';
  if (nearX(current.x + current.width) && nearY(current.y)) return 'resize-tr';
  if (nearX(current.x) && nearY(current.y + current.height)) return 'resize-bl';
  if (nearX(current.x + current.width) && nearY(current.y + current.height)) return 'resize-br';
  // 四边（对轴在内侧）
  if (nearY(current.y) && insideX) return 'resize-top';
  if (nearY(current.y + current.height) && insideX) return 'resize-bottom';
  if (nearX(current.x) && insideY) return 'resize-left';
  if (nearX(current.x + current.width) && insideY) return 'resize-right';
  if (insideX && insideY) return 'move';
  return 'create';
}

function cursorForMode(mode: DragMode): string {
  switch (mode) {
    case 'move':
      return 'move';
    case 'resize-tl':
    case 'resize-br':
      return 'nwse-resize';
    case 'resize-tr':
    case 'resize-bl':
      return 'nesw-resize';
    case 'resize-top':
    case 'resize-bottom':
      return 'ns-resize';
    case 'resize-left':
    case 'resize-right':
      return 'ew-resize';
    default:
      return 'crosshair';
  }
}

export function ImageCropper({ image, initialRect, onConfirm, onCancel }: ImageCropperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** 拖拽中注册的原生监听清理函数（pointerup/cancel 或组件卸载时调用，防止遗留监听）。 */
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [rect, setRect] = useState<Rect>(() =>
    clampCropRect(initialRect ?? { x: 0, y: 0, width: image.width, height: image.height }, image.width, image.height),
  );
  const [ratioMode, setRatioMode] = useState<RatioMode>('free');
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  // 卸载兜底：拖拽进行中组件被移除时清理画布上的监听
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  // 容器宽度自适应：画布始终等比显示，窄屏（手机）绝不拉伸变形
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // 先同步测一次，避免首帧按默认上限渲染后再收缩的闪现
    setContainerWidth(el.clientWidth > 0 ? Math.floor(el.clientWidth) : null);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(w > 0 ? Math.floor(w) : null);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const displayWidth = Math.max(1, Math.min(image.width, MAX_DISPLAY_WIDTH, containerWidth ?? image.width));
  const displayHeight = Math.max(1, Math.round((displayWidth * image.height) / image.width));
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

  /** 重绘：源图 + 选框遮罩 + 四角/四边手柄。 */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    canvas.width = Math.round(displayWidth * dpr);
    canvas.height = Math.round(displayHeight * dpr);
    // 显式 CSS 尺寸与容器测量一致：父容器（grid/flex）无法拉伸画布
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

    // 四角手柄（视觉 8px）+ 四边中点手柄（视觉 6px）
    ctx.fillStyle = '#3b82f6';
    for (const [hx, hy, size] of [
      [rx, ry, HANDLE_VISUAL],
      [rx + rw, ry, HANDLE_VISUAL],
      [rx, ry + rh, HANDLE_VISUAL],
      [rx + rw, ry + rh, HANDLE_VISUAL],
      [rx + rw / 2, ry, EDGE_HANDLE_VISUAL],
      [rx + rw / 2, ry + rh, EDGE_HANDLE_VISUAL],
      [rx, ry + rh / 2, EDGE_HANDLE_VISUAL],
      [rx + rw, ry + rh / 2, EDGE_HANDLE_VISUAL],
    ] as const) {
      ctx.fillRect(hx - size / 2, hy - size / 2, size, size);
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

  /** 指针位置钳制到图像范围内：拖到边框时平滑停靠，避免选区瞬移/跳变。 */
  const clampPointer = useCallback(
    (p: { x: number; y: number }) => ({
      x: Math.min(Math.max(p.x, 0), image.width),
      y: Math.min(Math.max(p.y, 0), image.height),
    }),
    [image.width, image.height],
  );

  const ratioFor = useCallback((mode: RatioMode): number | null => {
    if (mode === 'square') return 1;
    if (mode === 'original') return image.width / image.height;
    return null;
  }, [image.width, image.height]);

  const hitSize = useCallback(
    (bounds: { width: number; height: number }, isTouch: boolean) => {
      const hit = isTouch ? HANDLE_HIT_TOUCH : HANDLE_HIT;
      return {
        x: (hit / Math.max(bounds.width, 1)) * image.width,
        y: (hit / Math.max(bounds.height, 1)) * image.height,
      };
    },
    [image.width, image.height],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);

      const current = clampCropRect(rect, image.width, image.height);
      const p = toImageCoords(event.clientX, event.clientY);
      const bounds = canvas.getBoundingClientRect();
      const hit = hitSize(bounds, event.pointerType === 'touch');
      const mode = hitTestMode(p, current, hit.x, hit.y);
      canvas.style.cursor = cursorForMode(mode);

      const drag = {
        mode,
        startPointer: p,
        startRect: current,
      };

      /** 由指针位置计算选区（move/resize/create 共用；pointerup 时以此收敛最终值）。 */
      const nextRectFor = (q: { x: number; y: number }): Rect => {
        const qc = clampPointer(q);
        const dx = qc.x - drag.startPointer.x;
        const dy = qc.y - drag.startPointer.y;
        if (drag.mode === 'create') {
          // 拖拽框选：起点到当前点围成矩形
          const raw: Rect = {
            x: Math.min(drag.startPointer.x, qc.x),
            y: Math.min(drag.startPointer.y, qc.y),
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
        if (drag.mode === 'resize-top' || drag.mode === 'resize-bottom' || drag.mode === 'resize-left' || drag.mode === 'resize-right') {
          const edge: ResizeEdge = drag.mode === 'resize-top' ? 'top' : drag.mode === 'resize-bottom' ? 'bottom' : drag.mode === 'resize-left' ? 'left' : 'right';
          return resizeEdge(drag.startRect, edge, qc, ratioFor(ratioMode));
        }
        const anchor: AspectAnchor =
          drag.mode === 'resize-tl'
            ? 'bottom-right'
            : drag.mode === 'resize-tr'
              ? 'bottom-left'
              : drag.mode === 'resize-bl'
                ? 'top-right'
                : 'top-left';
        const moved = moveCorner(drag.startRect, drag.mode, qc);
        return ratioFor(ratioMode) !== null ? applyAspectLock(moved, ratioFor(ratioMode)!, anchor) : moved;
      };

      const onMove = (ev: PointerEvent) => {
        const q = toImageCoords(ev.clientX, ev.clientY);
        setRect(clampCropRect(nextRectFor(q), image.width, image.height));
      };

      const cleanupDragListeners = (): void => {
        canvas.removeEventListener('pointermove', onMove as unknown as EventListener);
        canvas.removeEventListener('pointerup', onUp as unknown as EventListener);
        canvas.removeEventListener('pointercancel', onUp as unknown as EventListener);
        dragCleanupRef.current = null;
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
        canvas.style.cursor = 'crosshair';
        cleanupDragListeners();
      };

      canvas.addEventListener('pointermove', onMove as unknown as EventListener);
      canvas.addEventListener('pointerup', onUp as unknown as EventListener);
      canvas.addEventListener('pointercancel', onUp as unknown as EventListener);
      dragCleanupRef.current = cleanupDragListeners;
    },
    [rect, image.width, image.height, ratioMode, ratioFor, toImageCoords, clampPointer, hitSize],
  );

  /** 桌面悬停：按位置切换光标（角/边/移动/框选）。 */
  const handleHover = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType !== 'mouse') return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const current = clampCropRect(rect, image.width, image.height);
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const hit = hitSize(bounds, false);
      const p = toImageCoords(event.clientX, event.clientY);
      canvas.style.cursor = cursorForMode(hitTestMode(p, current, hit.x, hit.y));
    },
    [rect, image.width, image.height, toImageCoords, hitSize],
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
        <div role="group" aria-label={crop.ariaRatioMode} className="flex gap-1 rounded-full border border-lilac/50 p-1 text-sm">
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
                'rounded-full px-2.5 py-1 transition-colors',
                ratioMode === mode ? 'bg-primary text-white' : 'text-ink-soft hover:bg-primary-soft',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="w-full">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label={crop.ariaCropCanvas}
          onPointerDown={handlePointerDown}
          onPointerMove={handleHover}
          onPointerLeave={() => {
            if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
          }}
          onKeyDown={handleKeyDown}
          // 首帧即按展示尺寸布局；displayWidth 由容器测量决定，画布严格等比
          width={displayWidth}
          height={displayHeight}
          style={{ width: displayWidth, height: displayHeight }}
          // 注意：必须是方角（rounded-none）——全图选区的四角手柄位于画布角点，
          // 圆角会裁掉角点命中区域导致拖拽失灵（E2E 05 角点拖拽回归依赖此行为）
          className="block touch-none select-none cursor-crosshair rounded-none outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-soft">
        <p>{crop.sizeLabel(current.width, current.height)}</p>
        <p className="hidden text-xs text-ink-soft/80 sm:block">
          {crop.dragHint}；{crop.nudgeHint}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="btn-outline"
        >
          {crop.cancel}
        </button>
        <button
          type="button"
          onClick={() => onConfirm({ x: 0, y: 0, width: image.width, height: image.height })}
          className="btn-outline"
        >
          {crop.useWholeImage}
        </button>
        <button type="button" onClick={confirm} className="btn-primary">
          {crop.confirm}
        </button>
      </div>
    </div>
  );
}

/** 按拖拽的角更新矩形（对角固定）。 */
function moveCorner(
  rect: Rect,
  mode: Exclude<DragMode, 'move' | 'create' | 'resize-top' | 'resize-bottom' | 'resize-left' | 'resize-right'>,
  p: { x: number; y: number },
): Rect {
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
