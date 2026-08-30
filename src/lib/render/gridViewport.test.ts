import { describe, expect, it } from 'vitest';
import {
  centerGridCameraOnCell,
  constrainGridCamera,
  fitBoardCamera,
  fitGridCamera,
  panGridCamera,
  screenPointToGridCell,
  visibleGridRange,
  zoomGridCameraAt,
} from './gridViewport';

describe('fitGridCamera', () => {
  it('在 CSS 像素视窗内完整容纳 200×200 图纸，DPR 不进入相机数学', () => {
    const camera = fitGridCamera(200, 200, { width: 390, height: 640 }, 16);

    expect(camera.cellPx).toBeCloseTo(1.79);
    expect(camera.offsetX).toBeCloseTo(16);
    expect(camera.offsetY).toBeCloseTo(141);
  });

  it('钳制格子尺寸到 1..64，非法输入安全回退', () => {
    expect(fitGridCamera(1, 1, { width: 1000, height: 1000 }).cellPx).toBe(64);
    expect(fitGridCamera(1000, 1000, { width: 10, height: 10 }).cellPx).toBe(1);
    expect(fitGridCamera(0, 200, { width: 390, height: 640 })).toEqual({
      cellPx: 1,
      offsetX: 0,
      offsetY: 0,
    });
    expect(fitGridCamera(200, 200, { width: Number.NaN, height: 640 })).toEqual({
      cellPx: 1,
      offsetX: 0,
      offsetY: 0,
    });
  });
});

describe('fitBoardCamera', () => {
  it('按最后一个不足 29 格的边缘板实际范围适配并居中', () => {
    const camera = fitBoardCamera(100, 63, 2, 3, { width: 300, height: 300 }, 29, 10);
    const edgeBoardCenterCol = (87 + 100) / 2;
    const edgeBoardCenterRow = (58 + 63) / 2;

    expect(camera.cellPx).toBeCloseTo(280 / 13);
    expect(camera.offsetX + edgeBoardCenterCol * camera.cellPx).toBeCloseTo(150);
    expect(camera.offsetY + edgeBoardCenterRow * camera.cellPx).toBeCloseTo(150);
    expect(13 * camera.cellPx).toBeLessThanOrEqual(280);
    expect(5 * camera.cellPx).toBeLessThanOrEqual(280);
  });
});

describe('centerGridCameraOnCell', () => {
  it('把目标格中心放到视窗中心，保留当前缩放', () => {
    expect(
      centerGridCameraOnCell(
        { cellPx: 10, offsetX: -999, offsetY: 999 },
        5,
        7,
        { width: 200, height: 100 },
      ),
    ).toEqual({ cellPx: 10, offsetX: 25, offsetY: -5 });
  });
});

describe('constrainGridCamera', () => {
  it('图纸小于视窗时始终居中', () => {
    expect(
      constrainGridCamera(
        { cellPx: 10, offsetX: -999, offsetY: 999 },
        10,
        5,
        { width: 300, height: 200 },
      ),
    ).toEqual({ cellPx: 10, offsetX: 100, offsetY: 75 });
  });

  it('大图钳制到两侧边缘仍可达，并允许显式 overscroll', () => {
    expect(
      constrainGridCamera(
        { cellPx: 10, offsetX: 80, offsetY: -700 },
        100,
        80,
        { width: 300, height: 200 },
      ),
    ).toEqual({ cellPx: 10, offsetX: 0, offsetY: -600 });

    expect(
      constrainGridCamera(
        { cellPx: 10, offsetX: -999, offsetY: 99 },
        100,
        80,
        { width: 300, height: 200 },
        20,
      ),
    ).toEqual({ cellPx: 10, offsetX: -720, offsetY: 20 });
  });
});

describe('zoomGridCameraAt', () => {
  it('在非零平移下缩放仍保持锚点指向同一世界坐标', () => {
    const camera = { cellPx: 10, offsetX: -35, offsetY: 20 };
    const anchor = { x: 145, y: 80 };
    const worldBefore = {
      x: (anchor.x - camera.offsetX) / camera.cellPx,
      y: (anchor.y - camera.offsetY) / camera.cellPx,
    };

    const zoomed = zoomGridCameraAt(camera, 25, anchor.x, anchor.y);

    expect((anchor.x - zoomed.offsetX) / zoomed.cellPx).toBeCloseTo(worldBefore.x);
    expect((anchor.y - zoomed.offsetY) / zoomed.cellPx).toBeCloseTo(worldBefore.y);
    expect(zoomGridCameraAt(camera, 100, anchor.x, anchor.y).cellPx).toBe(64);
  });
});

describe('panGridCamera', () => {
  it('在非零平移下只累计屏幕位移，不改变缩放', () => {
    expect(panGridCamera({ cellPx: 12, offsetX: -30, offsetY: 15 }, 7, -9)).toEqual({
      cellPx: 12,
      offsetX: -23,
      offsetY: 6,
    });
  });
});

describe('screenPointToGridCell', () => {
  it('按相机平移换算格子，图纸边界外返回 null', () => {
    const camera = { cellPx: 10, offsetX: -25, offsetY: -15 };

    expect(screenPointToGridCell(0, 0, camera, 200, 200)).toEqual({ row: 1, col: 2 });
    expect(screenPointToGridCell(-26, 0, camera, 200, 200)).toBeNull();
    expect(screenPointToGridCell(1975, 1985, camera, 200, 200)).toBeNull();
    expect(screenPointToGridCell(Number.NaN, 0, camera, 200, 200)).toBeNull();
  });
});

describe('visibleGridRange', () => {
  it('按非零平移计算可见格，四周多取一格并裁到图纸', () => {
    expect(
      visibleGridRange(
        { cellPx: 10, offsetX: -25, offsetY: -15 },
        13,
        10,
        { width: 100, height: 80 },
      ),
    ).toEqual({ rowStart: 0, rowEnd: 10, colStart: 1, colEnd: 13 });
  });
});

describe('非法输入契约', () => {
  it('所有公开计算都安全回退，不向调用方传播 NaN 或 Infinity', () => {
    const invalidCamera = { cellPx: Number.NaN, offsetX: Infinity, offsetY: -Infinity };
    const fallbackCamera = { cellPx: 1, offsetX: 0, offsetY: 0 };

    expect(panGridCamera(invalidCamera, Number.NaN, Infinity)).toEqual(fallbackCamera);
    expect(zoomGridCameraAt(invalidCamera, Number.NaN, Infinity, Number.NaN)).toEqual(
      fallbackCamera,
    );
    expect(centerGridCameraOnCell(invalidCamera, 0, 0, { width: 0, height: 0 })).toEqual(
      fallbackCamera,
    );
    expect(constrainGridCamera(invalidCamera, 0, 0, { width: 0, height: 0 })).toEqual(
      fallbackCamera,
    );
    expect(fitBoardCamera(0, 0, 0, 0, { width: 0, height: 0 })).toEqual(fallbackCamera);
    expect(screenPointToGridCell(Number.NaN, 0, invalidCamera, 10, 10)).toBeNull();
    expect(visibleGridRange(invalidCamera, 0, 0, { width: 0, height: 0 })).toEqual({
      rowStart: 0,
      rowEnd: 0,
      colStart: 0,
      colEnd: 0,
    });
  });
});
