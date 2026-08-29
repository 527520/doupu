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

  it('首帧同步测量用内容盒宽度（扣除容器内边距），避免被 max-width 夹扁的比例变形帧', () => {
    const image: DecodedImage = {
      data: new Uint8ClampedArray(640 * 400 * 4).fill(255),
      width: 640,
      height: 400,
      mime: 'image/png',
    };
    const proto = Element.prototype;
    const originalClientWidth = Object.getOwnPropertyDescriptor(proto, 'clientWidth');
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => 284 });
    const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () => ({ paddingLeft: '8px', paddingRight: '8px' }) as CSSStyleDeclaration,
    );
    try {
      render(<ImageCropper image={image} onConfirm={vi.fn()} onCancel={vi.fn()} />);
      const canvas = screen.getByLabelText(zhCN.crop.ariaCropCanvas) as HTMLCanvasElement;
      // 284 - 8 - 8 = 268；640×400 等比 → 268×168（高度四舍五入）。
      // 若误用含内边距的 clientWidth(284)，画布会被 max-width 夹成 268×178 的变形帧。
      expect(canvas.style.width).toBe('268px');
      expect(canvas.style.height).toBe('168px');
    } finally {
      gcs.mockRestore();
      if (originalClientWidth) Object.defineProperty(proto, 'clientWidth', originalClientWidth);
      else delete (proto as { clientWidth?: number }).clientWidth;
    }
  });

  it('按下裁剪画布会主动获取键盘焦点', () => {
    render(<ImageCropper image={makeImage()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const canvas = screen.getByLabelText(zhCN.crop.ariaCropCanvas) as HTMLCanvasElement;
    canvas.setPointerCapture = vi.fn();
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10 });
    expect(document.activeElement).toBe(canvas);
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10 });
  });

  it('状态区同时显示选区起点坐标和尺寸', () => {
    render(
      <ImageCropper
        image={makeImage()}
        initialRect={{ x: 10, y: 5, width: 40, height: 30 }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('选区起点：X 10 · Y 5')).toBeTruthy();
    expect(screen.getByText(zhCN.crop.sizeLabel(40, 30))).toBeTruthy();
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

  it('极窄长图预览的宽高和背板都不超过 800px', () => {
    const image: DecodedImage = {
      data: new Uint8ClampedArray(100 * 8000 * 4),
      width: 100,
      height: 8000,
      mime: 'image/png',
    };
    render(<ImageCropper image={image} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const canvas = screen.getByLabelText(zhCN.crop.ariaCropCanvas) as HTMLCanvasElement;
    expect(canvas.style.width).toBe('10px');
    // jsdom 容器宽为 0（未测出）：高度为 auto，由浏览器按固有比例随夹取宽度自动算高，
    // 避免 max-width:100% 只夹宽度造成变形中间帧；像素缓冲上界仍由宽高属性兜底。
    expect(canvas.style.height).toBe('auto');
    expect(canvas.width).toBeLessThanOrEqual(800 * (window.devicePixelRatio || 1));
    expect(canvas.height).toBeLessThanOrEqual(800 * (window.devicePixelRatio || 1));
  });

  it('有界预览仍以自然尺寸作为裁剪坐标并返回完整选区', () => {
    const onConfirm = vi.fn();
    const image: DecodedImage = {
      data: new Uint8ClampedArray(800 * 400 * 4),
      width: 800,
      height: 400,
      naturalWidth: 8000,
      naturalHeight: 4000,
      mime: 'image/png',
    };
    render(<ImageCropper image={image} onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(screen.getByText(zhCN.crop.sizeLabel(8000, 4000))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: zhCN.crop.useWholeImage }));
    expect(onConfirm).toHaveBeenCalledWith({ x: 0, y: 0, width: 8000, height: 4000 });
  });
});
