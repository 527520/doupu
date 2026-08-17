import { parentPort } from 'node:worker_threads';
import { generatePattern } from '../../src/lib/engine/generate';
import { clearLutCache } from '../../src/lib/engine/lut';
import { DEFAULT_GENERATION_PARAMS, type PaletteColor } from '../../src/lib/types';

if (!parentPort) throw new Error('generation cancellation probe requires a worker thread');

parentPort.on('message', ({ cancelBuffer }: { cancelBuffer: SharedArrayBuffer }) => {
  const cancelled = new Int32Array(cancelBuffer);
  const size = 800;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = i & 0xff;
    data[i * 4 + 1] = (i >> 3) & 0xff;
    data[i * 4 + 2] = (i >> 7) & 0xff;
    data[i * 4 + 3] = 255;
  }
  const palette: PaletteColor[] = Array.from({ length: 291 }, (_, index) => ({
    code: `P${index}`,
    hex: `#${((index * 57_353) & 0xffffff).toString(16).padStart(6, '0')}`,
  }));
  clearLutCache();
  try {
    generatePattern(
      { data, width: size, height: size },
      { ...DEFAULT_GENERATION_PARAMS, targetWidth: 200, targetColorCount: 291, dithering: true },
      palette,
      (percent) => parentPort!.postMessage({ type: 'progress', percent }),
      () => Atomics.load(cancelled, 0) === 1,
    );
    parentPort!.postMessage({ type: 'unexpected-complete' });
  } catch (error) {
    parentPort!.postMessage({
      type: 'stopped',
      name: error instanceof Error ? error.name : 'unknown',
      stoppedAt: performance.now(),
    });
  }
});
