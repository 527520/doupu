import type { DecodeResult } from './decodeCore';
import type { ImageType } from './sniff';

export type ImageDecodeWorkerRequest =
  | { type: 'probe'; requestId: number }
  | { type: 'load'; requestId: number; sourceId: number; bytes: Uint8Array; imageType: ImageType }
  | {
      type: 'region';
      requestId: number;
      sourceId: number;
      rect: { x: number; y: number; width: number; height: number };
      maxDimension: number;
    }
  | { type: 'clear'; sourceId: number };

export type ImageDecodeWorkerResponse =
  | { type: 'ready'; requestId: number }
  | { type: 'unsupported'; requestId: number }
  | { type: 'result'; requestId: number; result: DecodeResult; recoveredBytes?: Uint8Array }
  | { type: 'error'; requestId: number; message: string };
