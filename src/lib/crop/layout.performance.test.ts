import { describe, expect, it } from 'vitest';
import { cropImageData } from './layout';

describe('裁剪预览兼容路径性能预算（无 coverage instrumentation）', () => {
  it('有界预览裁剪不产生超过 50ms 的主线程长任务', () => {
    // 生产大图由 decodeImageRegion 在浏览器解码器内裁剪缩放；这个同步
    // 兼容路径只会接收 decodeImageFile 生成的 <=800px 预览缓冲。
    const width = 800;
    const height = 800;
    const data = new Uint8ClampedArray(width * height * 4);
    data.fill(255);

    const start = performance.now();
    const output = cropImageData(
      { data, width, height },
      { x: 0, y: 0, width, height },
      1_200,
    );
    const elapsed = performance.now() - start;

    expect(output).toMatchObject({ width: 800, height: 800 });
    expect(output.data).toHaveLength(800 * 800 * 4);
    expect(elapsed).toBeLessThan(50);
  });
});
