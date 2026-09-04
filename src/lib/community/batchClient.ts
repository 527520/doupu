import { LIMITS } from '@/lib/appInfo';

export const OFFICIAL_BATCH_LIMITS = { maxFiles: 50, maxTotalBytes: 200 * 1024 * 1024 } as const;

export function validateOfficialBatchFiles(files: readonly Pick<File, 'size' | 'type'>[]): string | null {
  if (files.length < 1 || files.length > OFFICIAL_BATCH_LIMITS.maxFiles) return '单批请选择 1–50 个文件';
  let total = 0;
  for (const file of files) {
    if (!file.type.startsWith('image/')) return '批次只接受图片文件';
    if (file.size > LIMITS.maxFileBytes) return '单个文件不能超过 20 MiB';
    total += file.size;
  }
  if (total > OFFICIAL_BATCH_LIMITS.maxTotalBytes) return '批次文件总大小不能超过 200 MiB';
  return null;
}

export function officialBatchConcurrency(hardwareConcurrency?: number, deviceMemory?: number): 1 | 2 {
  return (hardwareConcurrency !== undefined && hardwareConcurrency <= 4)
    || (deviceMemory !== undefined && deviceMemory <= 4) ? 1 : 2;
}
