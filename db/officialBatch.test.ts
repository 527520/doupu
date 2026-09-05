import { beforeEach, describe, expect, it } from 'vitest';
import { createTestClient, type TestDatabase } from './testClient';
import { adminAuditLogs, communityRevisions, communityWorks, officialBatches, users } from './schema';
import type { Actor } from '@/lib/auth/authorization';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';
import { createOfficialBatch, publishOfficialBatch, saveOfficialDraft, transitionOfficialBatch } from '@/lib/community/officialBatch';

const snapshot = {
  version: 1 as const, engineVersion: '2.0.0', boardProfile: '5mm-29' as const,
  paletteSelection: { palette: { kind: 'custom' as const, colors: [{ hex: '#FF0000', code: 'R' }] }, kitTier: 0 },
  params: { ...DEFAULT_GENERATION_PARAMS, targetWidth: 20, backgroundPrototype: null },
  pattern: { width: 1, height: 1, cells: [{ hex: '#FF0000', code: 'R', transparent: false }] },
};

describe('official browser-local batch persistence', () => {
  let db: TestDatabase; let admin: Actor;
  beforeEach(async () => {
    db = await createTestClient();
    const [user] = await db.insert(users).values({ email: 'admin@example.com', passwordHash: 'hash', role: 'admin', emailVerifiedAt: new Date() }).returning();
    admin = { userId: user.id, role: 'admin', accountStatus: 'active', emailVerified: true };
  });

  it('saves only generated snapshots as official drafts and publishes the explicit selection', async () => {
    const batch = await createOfficialBatch(db, { actor: admin, itemCount: 2, defaultParams: DEFAULT_GENERATION_PARAMS,
      engineVersion: '2.0.0', reason: '开始官方内容批次', requestId: 'start' });
    const first = await saveOfficialDraft(db, { actor: admin, batchId: batch.id, title: '官方作品 01', snapshot,
      reason: '保存成功生成结果', requestId: 'save-1' });
    const second = await saveOfficialDraft(db, { actor: admin, batchId: batch.id, title: '官方作品 02', snapshot,
      reason: '保存成功生成结果', requestId: 'save-2' });
    const finished = await transitionOfficialBatch(db, { actor: admin, batchId: batch.id, action: 'finish', expectedVersion: batch.version, reason: '完成全部图纸生成', requestId: 'finish' });
    const result = await publishOfficialBatch(db, { actor: admin, batchId: batch.id, revisionIds: [second.revisionId],
      expectedVersion: finished.version, reason: '复核勾选作品后发布', requestId: 'publish' });
    expect(result.batch).toMatchObject({ status: 'completed', successCount: 2, failureCount: 0 });
    const revisions = await db.select().from(communityRevisions);
    expect(revisions.find((item) => item.id === first.revisionId)?.status).toBe('draft');
    expect(revisions.find((item) => item.id === second.revisionId)).toMatchObject({ status: 'published', authorType: 'official', publicAuthorId: 'doupu-official', sourceDesignId: null });
    expect((await db.select().from(communityWorks)).find((work) => work.id === second.workId)?.currentPublishedRevisionId).toBe(second.revisionId);
    expect(await db.select().from(adminAuditLogs)).toHaveLength(5);
    const remaining = await publishOfficialBatch(db, { actor: admin, batchId: batch.id, revisionIds: [first.revisionId],
      expectedVersion: result.batch.version, reason: '再次复核剩余草稿后发布', requestId: 'publish-remaining' });
    expect(remaining.publishedRevisionIds).toEqual([first.revisionId]);
    expect((await db.select().from(communityRevisions)).every((revision) => revision.status === 'published')).toBe(true);
  });

  it('pauses without cancelling work and cancellation records unfinished items', async () => {
    const batch = await createOfficialBatch(db, { actor: admin, itemCount: 3, defaultParams: DEFAULT_GENERATION_PARAMS, engineVersion: '2.0.0', reason: '启动暂停测试批次', requestId: 'start' });
    const paused = await transitionOfficialBatch(db, { actor: admin, batchId: batch.id, action: 'pause', expectedVersion: 1, reason: '暂停派发新任务', requestId: 'pause' });
    expect(paused.status).toBe('paused');
    const cancelled = await transitionOfficialBatch(db, { actor: admin, batchId: batch.id, action: 'cancel', expectedVersion: paused.version, reason: '取消剩余任务', requestId: 'cancel' });
    expect(cancelled).toMatchObject({ status: 'cancelled', failureCount: 3 });
    expect((await db.select().from(officialBatches))[0].completedAt).not.toBeNull();
  });

  it('finishes generation independently of publishing and reopens incomplete items for retry', async () => {
    const batch = await createOfficialBatch(db, { actor: admin, itemCount: 2, defaultParams: DEFAULT_GENERATION_PARAMS,
      engineVersion: '2.0.0', reason: '独立验证生成完成', requestId: 'start' });
    await saveOfficialDraft(db, { actor: admin, batchId: batch.id, title: '成功项', snapshot, reason: '保存生成结果', requestId: 'save' });
    const finished = await transitionOfficialBatch(db, { actor: admin, batchId: batch.id, action: 'finish', expectedVersion: 1, reason: '所有本地任务结束', requestId: 'finish' });
    expect(finished).toMatchObject({ status: 'completed', successCount: 1, failureCount: 1 });
    expect(finished.completedAt).not.toBeNull();
    expect((await db.select().from(communityRevisions))[0].status).toBe('draft');
    const retrying = await transitionOfficialBatch(db, { actor: admin, batchId: batch.id, action: 'resume', expectedVersion: finished.version, reason: '重试本地失败项目', requestId: 'retry' });
    expect(retrying).toMatchObject({ status: 'running', completedAt: null, failureCount: 0 });
    await saveOfficialDraft(db, { actor: admin, batchId: batch.id, title: '重试成功项', snapshot, reason: '保存重试结果', requestId: 'save-again' });
    const done = await transitionOfficialBatch(db, { actor: admin, batchId: batch.id, action: 'finish', expectedVersion: retrying.version, reason: '全部任务已经完成', requestId: 'finish-again' });
    expect(done).toMatchObject({ status: 'completed', successCount: 2, failureCount: 0 });
    await expect(transitionOfficialBatch(db, { actor: admin, batchId: batch.id, action: 'resume', expectedVersion: done.version, reason: '没有剩余任务重试', requestId: 'invalid' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('continues saving after a partial publish and can publish saved drafts after cancellation', async () => {
    const batch = await createOfficialBatch(db, { actor: admin, itemCount: 3, defaultParams: DEFAULT_GENERATION_PARAMS,
      engineVersion: '2.0.0', reason: '验证生成与发布独立', requestId: 'start' });
    const first = await saveOfficialDraft(db, { actor: admin, batchId: batch.id, title: '先完成作品', snapshot, reason: '保存生成结果', requestId: 'first' });
    const result = await publishOfficialBatch(db, { actor: admin, batchId: batch.id, revisionIds: [first.revisionId], expectedVersion: 1, reason: '只发布先完成作品', requestId: 'publish-first' });
    expect(result.batch).toMatchObject({ status: 'running', failureCount: 0, completedAt: null });
    const second = await saveOfficialDraft(db, { actor: admin, batchId: batch.id, title: '后完成作品', snapshot, reason: '保存后续结果', requestId: 'second' });
    const cancelled = await transitionOfficialBatch(db, { actor: admin, batchId: batch.id, action: 'cancel', expectedVersion: result.batch.version, reason: '取消未完成生成', requestId: 'cancel' });
    const remaining = await publishOfficialBatch(db, { actor: admin, batchId: batch.id, revisionIds: [second.revisionId], expectedVersion: cancelled.version, reason: '复核保留草稿并发布', requestId: 'publish-second' });
    expect(remaining.batch).toMatchObject({ status: 'cancelled', failureCount: 1, completedAt: cancelled.completedAt });
  });

  it('rejects arbitrary batch metadata before it can reach persistence', async () => {
    await expect(createOfficialBatch(db, {
      actor: admin,
      itemCount: 1,
      defaultParams: { ...DEFAULT_GENERATION_PARAMS, fileName: 'private-photo.png', cropSource: 'private-bytes' },
      engineVersion: '2.0.0',
      reason: '验证批次参数隐私边界',
      requestId: 'private-params',
    })).rejects.toMatchObject({ code: 'VALIDATION', field: 'defaultParams' });
    expect(await db.select().from(officialBatches)).toHaveLength(0);
  });
});
