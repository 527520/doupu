import { LIMITS } from '@/lib/appInfo';
import { zhCN } from '@/messages/zh-CN';

/** Only known user-facing decoder explanations cross the Worker boundary. */
export function batchGenerationFailureMessage(error: unknown): string {
  const allowed: string[] = [zhCN.errors.DECODE_FAILED, zhCN.errors.HEIC_UNSUPPORTED, zhCN.errors.TOO_MANY_PIXELS, zhCN.communityAdmin.batch.unknownImage, zhCN.communityAdmin.batch.noOriginal];
  return error instanceof Error && allowed.includes(error.message) ? error.message : zhCN.communityAdmin.batch.generationFailed;
}

export const OFFICIAL_BATCH_LIMITS = { maxFiles: 50, maxTotalBytes: 200 * 1024 * 1024 } as const;

export function validateOfficialBatchFiles(files: readonly Pick<File, 'size' | 'type'>[]): string | null {
  if (files.length < 1 || files.length > OFFICIAL_BATCH_LIMITS.maxFiles) return zhCN.communityAdmin.batch.filesLimit;
  let total = 0;
  for (const file of files) {
    // HEIC/HEIF and drag-and-drop files may have no useful MIME type. The
    // authoritative content check uses magic bytes immediately before decode.
    if (file.type && file.type !== 'application/octet-stream' && !file.type.startsWith('image/')) return zhCN.communityAdmin.batch.imageFilesOnly;
    if (file.size > LIMITS.maxFileBytes) return zhCN.communityAdmin.batch.fileSizeLimit;
    total += file.size;
  }
  if (total > OFFICIAL_BATCH_LIMITS.maxTotalBytes) return zhCN.communityAdmin.batch.totalSizeLimit;
  return null;
}

export function officialBatchConcurrency(hardwareConcurrency?: number, deviceMemory?: number): 1 | 2 {
  return (hardwareConcurrency !== undefined && hardwareConcurrency <= 4)
    || (deviceMemory !== undefined && deviceMemory <= 4) ? 1 : 2;
}
