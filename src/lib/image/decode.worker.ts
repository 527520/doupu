/** Persistent off-main-thread image decoder. */
import {
  decodeImageFile,
  decodeImageRegion,
  type DecodeResult,
} from './decodeCore';
import type { ImageDecodeWorkerRequest, ImageDecodeWorkerResponse } from './decodeProtocol';
import type { ImageType } from './sniff';

let source: { sourceId: number; bytes: Uint8Array; imageType: ImageType } | null = null;

const workerScope = self as unknown as {
  postMessage(message: ImageDecodeWorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ImageDecodeWorkerRequest>) => void | Promise<void>) | null;
};

function postResult(requestId: number, result: DecodeResult, recoveredBytes?: Uint8Array): void {
  const message: ImageDecodeWorkerResponse = { type: 'result', requestId, result, recoveredBytes };
  if (result.ok && result.image.data.buffer instanceof ArrayBuffer) {
    workerScope.postMessage(message, [result.image.data.buffer]);
  } else if (recoveredBytes?.buffer instanceof ArrayBuffer) {
    workerScope.postMessage(message, [recoveredBytes.buffer]);
  } else {
    workerScope.postMessage(message);
  }
}

workerScope.onmessage = async (event): Promise<void> => {
  const request = event.data;
  if (request.type === 'probe') {
    const supported = typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined';
    workerScope.postMessage({
      type: supported ? 'ready' : 'unsupported',
      requestId: request.requestId,
    });
    return;
  }
  if (request.type === 'clear') {
    source = null;
    return;
  }
  if (request.type === 'load') {
    const loadedSource = { sourceId: request.sourceId, bytes: request.bytes, imageType: request.imageType };
    source = loadedSource;
    try {
      const result = await decodeImageFile(loadedSource.bytes, loadedSource.imageType);
      if (!result.ok && loadedSource.imageType === 'heic') {
        if (source?.sourceId === loadedSource.sourceId) source = null;
        // Native HEIC capability probing is the preview decode itself. Only on
        // failure is ownership transferred back for the existing WASM adapter.
        postResult(request.requestId, result, loadedSource.bytes);
      } else {
        postResult(request.requestId, result);
      }
    } catch (error) {
      workerScope.postMessage({
        type: 'error',
        requestId: request.requestId,
        message: error instanceof Error ? error.message : 'image preview decode failed',
      });
    }
    return;
  }
  if (!source || source.sourceId !== request.sourceId) {
    postResult(request.requestId, { ok: false, code: 'DECODE_FAILED' });
    return;
  }
  try {
    postResult(
      request.requestId,
      await decodeImageRegion(source.bytes, source.imageType, request.rect, request.maxDimension),
    );
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : 'image region decode failed',
    });
  }
};
