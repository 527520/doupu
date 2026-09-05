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
  // A reproducible, genuinely stitchable multicolour flower (not a two-cell
  // placeholder): exercises previews, colour bands, reuse and long colour lists.
  const seedColors = ['#FAF8F4','#292633','#B93E62','#DE7991','#497367','#81A18A','#E7B85C'].map((hex,index)=>({hex,code:`V${index}`}));
  const seedCells = Array.from({length:29*29},(_,index)=>{
    const x=index%29, y=Math.floor(index/29);
    let color=0;
    if(x>=13&&x<=15&&y>=12&&y<=25) color=4;
    if(((x-10)**2/24+(y-20)**2/8<1)||((x-18)**2/24+(y-22)**2/8<1)) color=x<14?4:5;
    const petals=[[14,6],[8,10],[20,10],[10,16],[18,16]];
    if(petals.some(([px,py])=>(x-px)**2+(y-py)**2<20)) color=x<14?2:3;
    if((x-14)**2+(y-11)**2<=13) color=6;
    if((x===12||x===16)&&y===10)color=1;
    return {...seedColors[color],transparent:false};
  });
  const project: ProjectFile = {
    format: 'doupu-project', version: 3, engineVersion: 'e2e', boardProfile: '5mm-29', name: 'E2E 私人设计',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    paletteSelection: { palette: { kind: 'custom', colors: seedColors }, kitTier: 0 },
    params: { ...DEFAULT_GENERATION_PARAMS, targetWidth: 29, targetColorCount: seedColors.length },
    pattern: { width: 29, height: 29, cells: seedCells },
  };
  await db.insert(designs).values({ id: designId, userId: user.userId, name: project.name, project, payloadBytes: JSON.stringify(project).length });
  const created = await createCommunityWork(db, { actor: user, designId, expectedDesignRevision: 1, title: 'E2E 已公开作品', licenseVersion: COMMUNITY_LICENSE_VERSION });
  const pending = await submitCommunityRevision(db, { actor: user, revisionId: created.revision.id, expectedVersion: 1 });
  await reviewCommunityRevision(db, { actor: admin, revisionId: pending.id, expectedVersion: pending.version, decision: 'published', reason: 'E2E 启动期公开样本', requestId: 'e2e-seed-publish' });
  const replacement = await createCommunityRevision(db, { actor: user, workId: created.work.id, designId, expectedDesignRevision: 1, title: 'E2E 待审修改版', licenseVersion: COMMUNITY_LICENSE_VERSION });
  await submitCommunityRevision(db, { actor: user, revisionId: replacement.id, expectedVersion: replacement.version });
  // 独立的待审视觉样本，不被治理旅程批准，便于持续检查真实审核处置界面。
  const visualPending = await createCommunityWork(db, { actor: user, designId, expectedDesignRevision: 1, title: '窗边的小花——待审视觉样本', licenseVersion: COMMUNITY_LICENSE_VERSION });
  await submitCommunityRevision(db, { actor: user, revisionId: visualPending.revision.id, expectedVersion: visualPending.revision.version });
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
