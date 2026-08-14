// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ImageCropper } from './ImageCropper';
import { zhCN } from '@/messages/zh-CN';
import type { DecodedImage } from '@/lib/image/decode';

/** 最小 2D 上下文桩：覆盖组件绘制所用到的方法。 */
function createFakeContext() {
  return {
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
  };
}

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    createFakeContext() as unknown as CanvasRenderingContext2D,
  );
});

afterAll(() => {
  vi.restoreAllMocks();
});

/** 100×50 的假图片（alpha 不透明）。 */
function makeImage(): DecodedImage {
  const data = new Uint8ClampedArray(100 * 50 * 4).fill(255);
  return { data, width: 100, height: 50, mime: 'image/png' };
}

describe('ImageCropper', () => {
  it('渲染标题、初始尺寸标签与全部操作按钮', () => {
    render(<ImageCropper image={makeImage()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(zhCN.crop.title)).toBeTruthy();
    expect(screen.getByText(zhCN.crop.sizeLabel(100, 50))).toBeTruthy();
    expect(screen.getByRole('button', { name: zhCN.crop.confirm })).toBeTruthy();
    expect(screen.getByRole('button', { name: zhCN.crop.cancel })).toBeTruthy();
    expect(screen.getByRole('button', { name: zhCN.crop.useWholeImage })).toBeTruthy();
    expect(screen.getByRole('button', { name: zhCN.crop.modeFree })).toBeTruthy();
    expect(screen.getByRole('button', { name: zhCN.crop.modeSquare })).toBeTruthy();
    expect(screen.getByRole('button', { name: zhCN.crop.modeOriginal })).toBeTruthy();
  });

  it('1:1 锁定产生正方形选区，确认回调传递合法矩形', () => {
    const onConfirm = vi.fn();
    render(<ImageCropper image={makeImage()} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.modeSquare }));
    // 100×50 居中锁 1:1 → 50×50，x=(100-50)/2=25
    expect(screen.getByText(zhCN.crop.sizeLabel(50, 50))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.confirm }));
    expect(onConfirm).toHaveBeenCalledWith({ x: 25, y: 0, width: 50, height: 50 });
  });

  it('「使用整张图片」确认完整矩形', () => {
    const onConfirm = vi.fn();
    render(<ImageCropper image={makeImage()} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.useWholeImage }));
    expect(onConfirm).toHaveBeenCalledWith({ x: 0, y: 0, width: 100, height: 50 });
  });

  it('取消回调', () => {
    const onCancel = vi.fn();
    render(<ImageCropper image={makeImage()} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.cancel }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('原始比例锁保持图像宽高比（2:1 图锁定后仍为 2:1）', () => {
    render(<ImageCropper image={makeImage()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.modeOriginal }));
    // 初始已是原始比例 → 尺寸不变
    expect(screen.getByText(zhCN.crop.sizeLabel(100, 50))).toBeTruthy();
  });

  it('initialRect 越界时被钳制到图像范围', () => {
    render(
      <ImageCropper
        image={makeImage()}
        initialRect={{ x: 60, y: 40, width: 30, height: 30 }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // 30×30 保持，x 钳制在 [0,70] → 60，y 钳制在 [0,20] → 20
    expect(screen.getByText(zhCN.crop.sizeLabel(30, 30))).toBeTruthy();
  });
});
