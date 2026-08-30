// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { panGridCamera, zoomGridCameraAt, type GridCamera } from '@/lib/render/gridViewport';
import { makeSolid } from '@/lib/editor/ops';
import { createStitchProgress } from '@/lib/progress/stitchProgress';
import type { Pattern } from '@/lib/types';
import PixelEditorCanvas from '@/components/editor/PixelEditorCanvas';
import StitchView from '@/components/stitch/StitchView';

const viewportHarness = vi.hoisted(() => {
  const renderedCamera: GridCamera = { cellPx: 20, offsetX: 0, offsetY: 0 };
  let currentCamera: GridCamera = renderedCamera;
  const applyCamera = vi.fn((next: GridCamera) => { currentCamera = next; });
  const panBy = vi.fn((dx: number, dy: number) => { currentCamera = panGridCamera(currentCamera, dx, dy); });

  return {
    renderedCamera,
    applyCamera,
    panBy,
    reset() {
      currentCamera = renderedCamera;
      applyCamera.mockClear();
      panBy.mockClear();
    },
    controller() {
      return {
        viewportRef: { current: null },
        size: { width: 100, height: 100 },
        camera: renderedCamera,
        readCamera: () => currentCamera,
        applyCamera,
        localPoint: (clientX: number, clientY: number) => ({ x: clientX, y: clientY }),
        cellAtClientPoint: () => ({ row: 0, col: 0 }),
        panBy,
        zoomAt: vi.fn(),
        fitPattern: vi.fn(),
        fitBoard: vi.fn(),
        centerCell: vi.fn(),
      };
    },
  };
});

vi.mock('@/components/canvas/useGridViewport', () => ({
  default: () => viewportHarness.controller(),
}));

const pattern: Pattern = {
  width: 3,
  height: 2,
  cells: Array.from({ length: 6 }, () => makeSolid('#FF0000', 'A1')),
};

function expectedPinchCamera(): GridCamera {
  const latestAfterPan = { cellPx: 20, offsetX: 10, offsetY: 5 };
  const startDistance = Math.hypot(40 - 20, 10 - 15);
  const nextDistance = Math.hypot(60 - 20, 10 - 15);
  const zoomed = zoomGridCameraAt(
    latestAfterPan,
    latestAfterPan.cellPx * (nextDistance / startDistance),
    30,
    12.5,
  );
  return panGridCamera(zoomed, 10, 0);
}

function panThenPinch(canvas: HTMLElement): void {
  fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
  fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 15 });
  fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', clientX: 40, clientY: 10 });
  fireEvent.pointerMove(canvas, { pointerId: 2, pointerType: 'touch', clientX: 60, clientY: 10 });
}

describe('单指平移切换双指缩放', () => {
  beforeEach(() => viewportHarness.reset());

  it('编辑画布从同步的最新平移相机建立缩放基线', () => {
    render(
      <PixelEditorCanvas
        pattern={pattern}
        palette={[{ hex: '#FF0000', code: 'A1' }]}
        layout="mobile"
      />,
    );

    panThenPinch(screen.getByLabelText('图纸编辑画布'));

    expect(viewportHarness.applyCamera).toHaveBeenLastCalledWith(expectedPinchCamera());
  });

  it('跟拼画布从同步的最新平移相机建立缩放基线', () => {
    render(
      <StitchView
        pattern={pattern}
        progress={createStitchProgress(pattern.width, pattern.height)}
        onChange={vi.fn()}
        layout="mobile"
      />,
    );

    panThenPinch(screen.getByRole('img', { name: /跟拼画布/ }));

    expect(viewportHarness.applyCamera).toHaveBeenLastCalledWith(expectedPinchCamera());
  });
});
