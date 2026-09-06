/** 测试夹具：给草稿修订挂一张最小 PNG 原图（D49 之后提交审核 / 官方发布都要求原图存在）。 */
import type { AnyDatabase } from './client';
import type { Actor } from '@/lib/auth/authorization';
import { storeRevisionOriginal } from '@/lib/community/originals';
import { createMemoryOriginalStore, type OriginalObjectStore } from '@/lib/community/originalStore';

/** 1×1 像素 PNG，通过魔数 / 尺寸 / 动图全部校验。 */
export const TEST_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAgAB/wdYqHkAAAAASUVORK5CYII=', 'base64');

export async function attachTestOriginal(db: AnyDatabase, actor: Actor, revisionId: string, store: OriginalObjectStore = createMemoryOriginalStore()) {
  return storeRevisionOriginal(db, store, { actor, revisionId, bytes: new Uint8Array(TEST_PNG) });
}
