import { ENGINE_VERSION, LIMITS } from '@/lib/appInfo';
import { createImageDecoder, type ImageDecoder } from '@/lib/image/decode';
import { sniffImageType } from '@/lib/image/sniff';
import { createGenerateWorkerClient, type GenerateTask, type GenerateWorkerClient } from '@/lib/engine/runGenerate';
import { paletteColorsForSelection } from '@/lib/engine/kit';
import { DEFAULT_OFFICIAL_BATCH_SPEC, type OfficialBatchSpec } from '@/lib/community/batchDefaults';
import type { GenerationParams } from '@/lib/types';
import type { BatchCrop, BatchGeneration } from './batchSession';
import type { CommunitySnapshotV1 } from '@/lib/community/snapshot';
import { zhCN } from '@/messages/zh-CN';

export interface BatchGenerateClients {
  decoder: ImageDecoder;
  generator: GenerateWorkerClient;
}

/** Cancellation covers file read completion, decoding, region extraction and generation.
 * Owned clients (the default) are disposed before network saving begins.
 * Pooled clients stay alive across items so 50 张草稿不必反复拉起 Worker。 */
export function generateBatchItem(
  input: { file: File; crop: BatchCrop | null; params: GenerationParams; spec?: OfficialBatchSpec },
  progress: (value: number) => void,
  clients?: BatchGenerateClients,
): BatchGeneration {
  const spec = input.spec ?? DEFAULT_OFFICIAL_BATCH_SPEC;
  const owned = !clients;
  const decoder = clients?.decoder ?? createImageDecoder();
  const generator = clients?.generator ?? createGenerateWorkerClient();
  let cancelled = false; let task: GenerateTask | null = null;
  let decoderDisposed = false;
  const releaseDecoder = () => {
    if (!owned) {
      decoder.clear();
      return;
    }
    if (!decoderDisposed) { decoderDisposed = true; decoder.dispose(); }
  };
  const check = () => { if (cancelled) throw new DOMException('Cancelled', 'AbortError'); };
  const promise = (async (): Promise<CommunitySnapshotV1> => {
    try {
      const bytes = new Uint8Array(await input.file.arrayBuffer()); check();
      const type = sniffImageType(bytes); if (type === 'unknown') throw new Error(zhCN.communityAdmin.batch.unknownImage);
      const loaded = await decoder.load(bytes, type); check(); if (!loaded.ok) throw new Error(zhCN.errors[loaded.code]);
      const width = loaded.image.naturalWidth ?? loaded.image.width; const height = loaded.image.naturalHeight ?? loaded.image.height;
      if (width * height > LIMITS.maxPixels) throw new Error(zhCN.errors.TOO_MANY_PIXELS);
      const region = await decoder.region(input.crop ?? { x: 0, y: 0, width, height }, LIMITS.generationSourceDimension);
      check(); if (!region.ok) throw new Error(zhCN.errors[region.code]); decoder.clear();
      if (owned) releaseDecoder();
      task = generator.run({ src: region.image, params: input.params, palette: paletteColorsForSelection(spec.paletteSelection) }, progress);
      const output = await task.promise; check();
      return { version: 1, engineVersion: ENGINE_VERSION, boardProfile: spec.boardProfile, paletteSelection: spec.paletteSelection, params: { ...input.params, backgroundPrototype: input.params.backgroundPrototype ?? null }, pattern: output.pattern };
    } catch (error) { check(); throw error; }
    finally {
      if (owned) { releaseDecoder(); generator.dispose(); }
      else decoder.clear();
    }
  })();
  return { promise, cancel: () => { if (cancelled) return; cancelled = true; task?.cancel(); if (owned) { releaseDecoder(); generator.dispose(); } else decoder.clear(); } };
}

/** 官方批次按并发度常驻解码/生成 Worker，避免 50 项各拉起一对线程。 */
export function createOfficialBatchGeneratePool(concurrency: 1 | 2) {
  const slots = Array.from({ length: concurrency }, () => ({
    decoder: createImageDecoder(),
    generator: createGenerateWorkerClient(),
    busy: false,
  }));
  return {
    generate(
      input: { file: File; crop: BatchCrop | null; params: GenerationParams; spec: OfficialBatchSpec },
      progress: (value: number) => void,
    ): BatchGeneration {
      const slot = slots.find((entry) => !entry.busy);
      if (!slot) return generateBatchItem(input, progress);
      slot.busy = true;
      const task = generateBatchItem(input, progress, slot);
      return {
        promise: task.promise.finally(() => { slot.busy = false; }),
        cancel: task.cancel,
      };
    },
    dispose() {
      for (const slot of slots) {
        slot.decoder.dispose();
        slot.generator.dispose();
      }
    },
  };
}
