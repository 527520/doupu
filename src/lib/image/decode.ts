/** Browser-side persistent image decoder adapter (spec §F1). */
import {
  decodeImageFile,
  decodeImageRegion,
  encodedImageBlob,
  type DecodeResult,
} from './decodeCore';
import type { ImageDecodeWorkerRequest, ImageDecodeWorkerResponse } from './decodeProtocol';
import type { ImageType } from './sniff';

export { decodeImageFile, decodeImageRegion } from './decodeCore';
export type { DecodedImage, DecodeResult } from './decodeCore';
export type { ImageDecodeWorkerRequest, ImageDecodeWorkerResponse } from './decodeProtocol';

export interface ImageDecoder {
  /** Consumes the encoded bytes when the Worker path is available. */
  load(bytes: Uint8Array, type: ImageType, onHeicFallback?: () => void): Promise<DecodeResult>;
  region(
    rect: { x: number; y: number; width: number; height: number },
    maxDimension: number,
  ): Promise<DecodeResult>;
  clear(): void;
  dispose(): void;
}

/** Legacy direct capability helper. Workbench probes by decoding in its Worker. */
export async function canDecodeHeicNatively(bytes?: Uint8Array): Promise<boolean> {
  if (!bytes || bytes.length === 0) return false;
  try {
    const bitmap = await createImageBitmap(encodedImageBlob(bytes, 'heic'));
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

/** Existing HEIC WASM compatibility adapter; libheif decoding runs in its own Worker. */
export async function convertHeicWithWasm(bytes: Uint8Array): Promise<Uint8Array> {
  const { default: heic2any } = await import('heic2any');
  const result = await heic2any({
    blob: encodedImageBlob(bytes, 'heic'),
    toType: 'image/jpeg',
    quality: 0.92,
  });
  const out = Array.isArray(result) ? result[0] : result;
  if (!out) throw new Error('HEIC 转换无输出');
  return new Uint8Array(await out.arrayBuffer());
}

/**
 * Owns one persistent image Worker and one encoded source. Unsupported
 * environments retain the same interface but execute the bounded core on the
 * caller thread so upload remains functional.
 */
export function createImageDecoder(): ImageDecoder {
  let worker: Worker | null = null;
  let workerSupported: boolean | null = null;
  let probePromise: Promise<boolean> | null = null;
  let requestId = 0;
  let sourceId = 0;
  let hasWorkerSource = false;
  let fallbackSource: { bytes: Uint8Array; type: ImageType } | null = null;
  const pending = new Map<number, {
    resolve: (response: ImageDecodeWorkerResponse) => void;
    reject: (error: Error) => void;
  }>();

  const failPending = (error: Error): void => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };

  const destroyWorker = (): void => {
    worker?.terminate();
    worker = null;
    workerSupported = false;
    hasWorkerSource = false;
  };

  const post = (
    request: Exclude<ImageDecodeWorkerRequest, { type: 'clear' }>,
    transfer: Transferable[] = [],
  ): Promise<ImageDecodeWorkerResponse> => {
    if (!worker) return Promise.reject(new Error('image decoder worker is unavailable'));
    return new Promise((resolve, reject) => {
      pending.set(request.requestId, { resolve, reject });
      try {
        worker!.postMessage(request, transfer);
      } catch (error) {
        pending.delete(request.requestId);
        reject(error instanceof Error ? error : new Error('image decoder postMessage failed'));
      }
    });
  };

  const ensureWorker = async (): Promise<boolean> => {
    if (workerSupported !== null) return workerSupported;
    if (probePromise) return probePromise;
    probePromise = (async () => {
      if (
        typeof Worker === 'undefined'
        || typeof OffscreenCanvas === 'undefined'
        || typeof createImageBitmap === 'undefined'
      ) {
        workerSupported = false;
        return false;
      }
      try {
        worker = new Worker(new URL('./decode.worker.ts', import.meta.url));
        worker.onmessage = (event: MessageEvent<ImageDecodeWorkerResponse>) => {
          const response = event.data;
          const waiter = pending.get(response.requestId);
          if (!waiter) return;
          pending.delete(response.requestId);
          if (response.type === 'error') waiter.reject(new Error(response.message));
          else waiter.resolve(response);
        };
        worker.onerror = (event) => {
          failPending(new Error(event.message || 'image decoder worker failed'));
          destroyWorker();
        };
        const response = await post({ type: 'probe', requestId: ++requestId });
        workerSupported = response.type === 'ready';
        if (!workerSupported) destroyWorker();
        return workerSupported;
      } catch {
        destroyWorker();
        return false;
      }
    })();
    return probePromise;
  };

  return {
    async load(bytes, type, onHeicFallback) {
      fallbackSource = null;
      hasWorkerSource = false;
      if (!(await ensureWorker())) {
        fallbackSource = { bytes, type };
        let result = await decodeImageFile(bytes, type);
        if (!result.ok && type === 'heic') {
          onHeicFallback?.();
          try {
            const converted = await convertHeicWithWasm(bytes);
            fallbackSource = { bytes: converted, type: 'jpeg' };
            result = await decodeImageFile(converted, 'jpeg');
          } catch {
            result = { ok: false, code: 'HEIC_UNSUPPORTED' };
          }
        }
        if (!result.ok) fallbackSource = null;
        return result;
      }
      const loadInWorker = async (
        encoded: Uint8Array,
        imageType: ImageType,
      ): Promise<Extract<ImageDecodeWorkerResponse, { type: 'result' }> | null> => {
        const owned = encoded.byteOffset === 0
          && encoded.buffer instanceof ArrayBuffer
          && encoded.byteLength === encoded.buffer.byteLength
          ? encoded
          : encoded.slice();
        const nextSourceId = ++sourceId;
        const response = await post(
          { type: 'load', requestId: ++requestId, sourceId: nextSourceId, bytes: owned, imageType },
          [owned.buffer as ArrayBuffer],
        );
        return response.type === 'result' ? response : null;
      };
      try {
        let response = await loadInWorker(bytes, type);
        if (type === 'heic' && response && !response.result.ok && response.recoveredBytes) {
          onHeicFallback?.();
          const converted = await convertHeicWithWasm(response.recoveredBytes);
          response = await loadInWorker(converted, 'jpeg');
        }
        hasWorkerSource = Boolean(response?.result.ok);
        return response?.result
          ?? { ok: false, code: type === 'heic' ? 'HEIC_UNSUPPORTED' : 'DECODE_FAILED' };
      } catch {
        destroyWorker();
        return { ok: false, code: type === 'heic' ? 'HEIC_UNSUPPORTED' : 'DECODE_FAILED' };
      }
    },
    async region(rect, maxDimension) {
      if (hasWorkerSource && worker) {
        try {
          const response = await post({
            type: 'region',
            requestId: ++requestId,
            sourceId,
            rect,
            maxDimension,
          });
          return response.type === 'result' ? response.result : { ok: false, code: 'DECODE_FAILED' };
        } catch {
          destroyWorker();
          return { ok: false, code: 'DECODE_FAILED' };
        }
      }
      if (!fallbackSource) return { ok: false, code: 'DECODE_FAILED' };
      return decodeImageRegion(fallbackSource.bytes, fallbackSource.type, rect, maxDimension);
    },
    clear() {
      fallbackSource = null;
      hasWorkerSource = false;
      sourceId += 1;
      try {
        worker?.postMessage({ type: 'clear', sourceId } satisfies ImageDecodeWorkerRequest);
      } catch {
        destroyWorker();
      }
    },
    dispose() {
      fallbackSource = null;
      hasWorkerSource = false;
      failPending(new Error('image decoder disposed'));
      destroyWorker();
      // React Strict Mode runs effect cleanup/setup twice in development.
      workerSupported = null;
      probePromise = null;
    },
  };
}
