import { ENGINE_VERSION, LIMITS } from '@/lib/appInfo';
import { createImageDecoder } from '@/lib/image/decode';
import { sniffImageType } from '@/lib/image/sniff';
import { createGenerateWorkerClient, type GenerateTask } from '@/lib/engine/runGenerate';
import { paletteColorsForSelection } from '@/lib/engine/kit';
import { DEFAULT_OFFICIAL_BATCH_SPEC, type OfficialBatchSpec } from '@/lib/community/batchDefaults';
import type { GenerationParams } from '@/lib/types';
import type { BatchCrop, BatchGeneration } from './batchSession';
import type { CommunitySnapshotV1 } from '@/lib/community/snapshot';
import { zhCN } from '@/messages/zh-CN';

/** Cancellation covers file read completion, decoding, region extraction and generation.
 * Each item releases both workers and every image buffer before network saving begins. */
export function generateBatchItem(input: { file: File; crop: BatchCrop | null; params: GenerationParams; spec?: OfficialBatchSpec }, progress: (value: number) => void): BatchGeneration {
  const spec = input.spec ?? DEFAULT_OFFICIAL_BATCH_SPEC;
  const decoder = createImageDecoder(); const generator = createGenerateWorkerClient();
  let cancelled = false; let task: GenerateTask | null = null;
  let decoderDisposed = false;
  const releaseDecoder = () => { if (!decoderDisposed) { decoderDisposed = true; decoder.dispose(); } };
  const check = () => { if (cancelled) throw new DOMException('Cancelled', 'AbortError'); };
  const promise = (async (): Promise<CommunitySnapshotV1> => {
    try {
      const bytes = new Uint8Array(await input.file.arrayBuffer()); check();
      const type = sniffImageType(bytes); if (type === 'unknown') throw new Error(zhCN.communityAdmin.batch.unknownImage);
      const loaded = await decoder.load(bytes, type); check(); if (!loaded.ok) throw new Error(zhCN.errors[loaded.code]);
      const width = loaded.image.naturalWidth ?? loaded.image.width; const height = loaded.image.naturalHeight ?? loaded.image.height;
      if (width * height > LIMITS.maxPixels) throw new Error(zhCN.errors.TOO_MANY_PIXELS);
      const region = await decoder.region(input.crop ?? { x: 0, y: 0, width, height }, LIMITS.generationSourceDimension);
      check(); if (!region.ok) throw new Error(zhCN.errors[region.code]); decoder.clear(); releaseDecoder();
      task = generator.run({ src: region.image, params: input.params, palette: paletteColorsForSelection(spec.paletteSelection) }, progress);
      const output = await task.promise; check();
      return { version: 1, engineVersion: ENGINE_VERSION, boardProfile: spec.boardProfile, paletteSelection: spec.paletteSelection, params: { ...input.params, backgroundPrototype: input.params.backgroundPrototype ?? null }, pattern: output.pattern };
    } catch (error) { check(); throw error; }
    finally { releaseDecoder(); generator.dispose(); }
  })();
  return { promise, cancel: () => { if (cancelled) return; cancelled = true; task?.cancel(); releaseDecoder(); generator.dispose(); } };
}
