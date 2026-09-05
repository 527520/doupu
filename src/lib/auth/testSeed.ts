import { count, eq } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import { designs, users } from '@/../db/schema';
import { hashPassword } from './password';
import type { Actor } from './authorization';
import { DEFAULT_GENERATION_PARAMS, type ProjectFile } from '@/lib/types';
import { COMMUNITY_LICENSE_VERSION } from '@/lib/community/snapshot';
import { createCommunityRevision, createCommunityWork, reviewCommunityRevision, submitCommunityRevision } from '@/lib/community/service';
import { createCommunityComment, createModerationRuleSet, reportCommunityTarget } from '@/lib/community/interactions';

/** Non-production startup fixture. It is deliberately not reachable over HTTP. */
export async function seedE2eGovernance(db: AnyDatabase): Promise<void> {
  if (process.env.NODE_ENV === 'production' || process.env.DOUPU_E2E_SEED !== '1') return;
  const [existing] = await db.select({ value: count() }).from(users).where(eq(users.email, 'e2e-admin@example.com'));
  if (existing.value > 0) return;
  const passwordHash = await hashPassword('E2e-pass-123!');
  const [adminRow, moderatorRow, userRow] = await db.insert(users).values([
    { email: 'e2e-admin@example.com', username: 'E2E Admin', passwordHash, role: 'admin', emailVerifiedAt: new Date() },
    { email: 'e2e-moderator@example.com', username: 'E2E Moderator', passwordHash, role: 'moderator', emailVerifiedAt: new Date() },
    { email: 'e2e-user@example.com', username: 'E2E User', passwordHash, role: 'user', emailVerifiedAt: new Date() },
    ...['chromium', 'firefox', 'webkit'].map((browser) => ({ email: `e2e-governance-${browser}@example.com`, username: `E2E 治理目标 ${browser}`, passwordHash, role: 'user' as const, emailVerifiedAt: new Date() })),
  ]).returning();
  const admin: Actor = { userId: adminRow.id, role: 'admin', accountStatus: 'active', emailVerified: true };
  const user: Actor = { userId: userRow.id, role: 'user', accountStatus: 'active', emailVerified: true };
  const designId = crypto.randomUUID();
  const project: ProjectFile = {
    format: 'doupu-project', version: 3, engineVersion: 'e2e', boardProfile: '5mm-29', name: 'E2E 私人设计',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    paletteSelection: { palette: { kind: 'custom', colors: [{ hex: '#C2385A', code: 'R' }] }, kitTier: 0 },
    params: { ...DEFAULT_GENERATION_PARAMS, targetWidth: 20, targetColorCount: 2 },
    pattern: { width: 2, height: 1, cells: [{ hex: '#C2385A', code: 'R', transparent: false }, { hex: '#C2385A', code: 'R', transparent: false }] },
  };
  await db.insert(designs).values({ id: designId, userId: user.userId, name: project.name, project, payloadBytes: JSON.stringify(project).length });
  const created = await createCommunityWork(db, { actor: user, designId, expectedDesignRevision: 1, title: 'E2E 已公开作品', licenseVersion: COMMUNITY_LICENSE_VERSION });
  const pending = await submitCommunityRevision(db, { actor: user, revisionId: created.revision.id, expectedVersion: 1 });
  await reviewCommunityRevision(db, { actor: admin, revisionId: pending.id, expectedVersion: pending.version, decision: 'published', reason: 'E2E 启动期公开样本', requestId: 'e2e-seed-publish' });
  const replacement = await createCommunityRevision(db, { actor: user, workId: created.work.id, designId, expectedDesignRevision: 1, title: 'E2E 待审修改版', licenseVersion: COMMUNITY_LICENSE_VERSION });
  await submitCommunityRevision(db, { actor: user, revisionId: replacement.id, expectedVersion: replacement.version });
  await createModerationRuleSet(db, { actor: admin, expectedVersion: 1, rules: [{ literal: 'E2E风险词', category: 'spam', risk: 'review' }], reason: 'E2E 启动期规则', requestId: 'e2e-seed-rules' });
  await createCommunityComment(db, { actor: user, workId: created.work.id, body: '包含 E2E风险词 的评论' });
  for (const browser of ['chromium', 'firefox', 'webkit']) {
    await createCommunityComment(db, { actor: user, workId: created.work.id, body: `E2E 可删除旧评论 ${browser}`, now: new Date(Date.now() - 30 * 60 * 1000) });
    await createCommunityComment(db, { actor: user, workId: created.work.id, body: `E2E风险词 待审删除 ${browser}` });
  }
  const reportedComment = await createCommunityComment(db, { actor: admin, workId: created.work.id, body: 'E2E 被举报评论' });
  await reportCommunityTarget(db, { actor: user, targetType: 'comment', targetId: reportedComment.id, category: 'other' });
  await reportCommunityTarget(db, { actor: user, targetType: 'work', targetId: created.work.id, category: 'other' });
  void moderatorRow;
}
