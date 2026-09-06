/** 浏览器侧原图接口封装（D49）：上传、取回、探测。 */
import { LIMITS } from '@/lib/appInfo';
import { sniffImageType, type ImageType } from '@/lib/image/sniff';

export class OriginalUploadError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'OriginalUploadError';
  }
}

async function readError(response: Response, fallback: string): Promise<OriginalUploadError> {
  try {
    const body = await response.json() as { error?: { code?: string; message?: string } };
    return new OriginalUploadError(response.status, body.error?.code ?? 'UNKNOWN', body.error?.message ?? fallback);
  } catch {
    return new OriginalUploadError(response.status, 'UNKNOWN', fallback);
  }
}

export interface UploadedOriginal { revisionId: string; mimeType: string; byteSize: number; width: number | null; height: number | null }

/** 上传原图字节到某草稿修订；服务端按魔数判定类型，这里只带 octet-stream。 */
export async function uploadRevisionOriginal(revisionId: string, bytes: Uint8Array, fetcher: typeof fetch = fetch): Promise<UploadedOriginal> {
  if (bytes.byteLength === 0) throw new OriginalUploadError(400, 'VALIDATION', '原图为空');
  if (bytes.byteLength > LIMITS.maxFileBytes) throw new OriginalUploadError(413, 'PAYLOAD_TOO_LARGE', '原图超过 20 MB 上限');
  const response = await fetcher(`/api/community/revisions/${revisionId}/original`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Uint8Array(bytes),
    credentials: 'same-origin',
  });
  if (!response.ok) throw await readError(response, '原图上传失败');
  return response.json() as Promise<UploadedOriginal>;
}

export interface FetchedOriginal { bytes: Uint8Array; type: ImageType }

/** 取回原图；无权限或不存在返回 null。 */
export async function fetchRevisionOriginal(revisionId: string, fetcher: typeof fetch = fetch): Promise<FetchedOriginal | null> {
  const response = await fetcher(`/api/community/revisions/${revisionId}/original`, { credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw await readError(response, '原图读取失败');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const type = sniffImageType(bytes);
  if (type === 'unknown') return null;
  return { bytes, type };
}

/** 是否可取回（不下载字节）。 */
export async function canFetchRevisionOriginal(revisionId: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher(`/api/community/revisions/${revisionId}/original`, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}
