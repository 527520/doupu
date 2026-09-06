/**
 * 评论审核管线（D50）。
 *
 *   本地结构检查 → 反刷闸门（账号/IP 限流、突发与重复）→ 同文缓存 → 日预算 → 腾讯云文本内容安全
 *
 * 每一步都产出一条判定记录（comment_moderation_checks）；正文本身只留在评论表。
 * 腾讯云不可用（未配置 / 失败 / 超预算）时评论进入待审，绝不静默发布。
 * 判定结果：published 直发 | pending_review 人工复核 | rejected 拒绝（评论以 rejected 状态留档）。
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import { commentModerationChecks, communityComments } from '@/../db/schema';
import { checkRateLimit, hourlyWindowStart } from '@/lib/auth/rateLimit';
import { config } from '@/lib/config';
import { moderateTextWithTms, resolveTmsCredentials, tmsUserToken, type TmsCredentials, type TmsSuggestion, type TmsVerdict } from './tencentTms';

/** rate_limited：未创建评论，仅留痕；调用方在事务提交后再向用户返回 429。 */
export type CommentDecisionStatus = 'published' | 'pending_review' | 'rejected' | 'rate_limited';
export type ModerationProvider = 'tencent-tms' | 'cached' | 'local' | 'unavailable';
export type ModerationReason =
  | 'tms_pass' | 'tms_review' | 'tms_block' | 'cached_pass' | 'cached_review' | 'cached_block'
  | 'local_structure' | 'burst' | 'duplicate' | 'rate_limited' | 'budget_exhausted' | 'provider_disabled' | 'provider_error';

export interface CommentModerationDecision {
  status: CommentDecisionStatus;
  categories: string[];
  checkId: string;
  provider: ModerationProvider;
  reason: ModerationReason;
}

export interface CommentModerationInput {
  userId: string;
  publicAuthorId: string;
  workId: string;
  body: string;
  now: Date;
  /** 编辑评论时排除自身，避免把自己上一版当作重复。 */
  excludeCommentId?: string;
  /** 客户端 IP（可选）；未知时不做 IP 限流。 */
  ip?: string | null;
}

export interface CommentModerationDeps {
  credentials?: TmsCredentials | null;
  fetcher?: typeof fetch;
  /** 测试注入：直接返回判定，跳过网络。 */
  moderate?: (creds: TmsCredentials, input: { content: string; dataId: string; userToken?: string }) => Promise<TmsVerdict>;
}

/** 腾讯云标签 → 豆社风险分类（与举报分类共用同一套中文映射）。 */
export function riskCategoryForLabel(label: string): string | null {
  switch (label) {
    case 'Normal': return null;
    case 'Porn': return 'sexual';
    case 'Abuse': return 'harassment';
    case 'Ad': return 'spam';
    case 'Illegal':
    case 'Terror': return 'harm';
    default: return 'other';
  }
}

/** 进程内服务健康快照：系统信息页据此提示「内容安全服务异常」。 */
interface ProviderHealth { lastErrorAt: Date | null; lastErrorCode: string | null; consecutiveFailures: number; lastSuccessAt: Date | null }
const health: ProviderHealth = { lastErrorAt: null, lastErrorCode: null, consecutiveFailures: 0, lastSuccessAt: null };
export function getModerationProviderHealth(): Readonly<ProviderHealth> { return { ...health }; }
export function resetModerationProviderHealth(): void { health.lastErrorAt = null; health.lastErrorCode = null; health.consecutiveFailures = 0; health.lastSuccessAt = null; }

export function normalizeCommentText(body: string): string {
  return body.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('zh-CN');
}

export function commentTextHash(body: string): string {
  return createHash('sha256').update(normalizeCommentText(body), 'utf8').digest('hex');
}

/** 结构性垃圾特征：多链接、控制字符、超长重复；不依赖任何词库。 */
export function localStructureFlags(body: string): string[] {
  const normalized = body.normalize('NFKC');
  const flags: string[] = [];
  if ((normalized.match(/(?:https?:\/\/|www\.)/giu)?.length ?? 0) > 1) flags.push('links');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) flags.push('control');
  if (/(.)\1{9,}/u.test(normalized)) flags.push('repeat');
  return flags;
}

function dayWindowStart(now: Date): Date {
  // 与分析维护一致按上海日切分，日预算与「每天」限额对使用者更直观。
  const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  shanghai.setUTCHours(0, 0, 0, 0);
  return new Date(shanghai.getTime() - 8 * 60 * 60 * 1000);
}

async function record(tx: AnyDatabase, input: CommentModerationInput, entry: {
  provider: ModerationProvider; outcome: CommentDecisionStatus; reason: ModerationReason;
  verdict?: Partial<Pick<TmsVerdict, 'suggestion' | 'label' | 'subLabel' | 'score' | 'keywords' | 'requestId' | 'latencyMs'>>;
}): Promise<string> {
  const [row] = await tx.insert(commentModerationChecks).values({
    userId: input.userId, workId: input.workId,
    textHash: commentTextHash(input.body), textLength: input.body.length,
    provider: entry.provider, outcome: entry.outcome, reason: entry.reason,
    suggestion: entry.verdict?.suggestion ?? null, label: entry.verdict?.label ?? null, subLabel: entry.verdict?.subLabel ?? null,
    score: entry.verdict?.score ?? null, keywords: entry.verdict?.keywords ?? null,
    tmsRequestId: entry.verdict?.requestId ?? null, latencyMs: entry.verdict?.latencyMs ?? null,
    createdAt: input.now,
  }).returning();
  return row.id;
}

function decisionFor(suggestion: TmsSuggestion): CommentDecisionStatus {
  return suggestion === 'Pass' ? 'published' : suggestion === 'Review' ? 'pending_review' : 'rejected';
}

export async function moderateComment(tx: AnyDatabase, input: CommentModerationInput, deps: CommentModerationDeps = {}): Promise<CommentModerationDecision> {
  const limits = config.moderation;
  const finish = async (status: CommentDecisionStatus, categories: string[], provider: ModerationProvider, reason: ModerationReason, verdict?: Partial<TmsVerdict>): Promise<CommentModerationDecision> => ({
    status, categories: [...new Set(categories)].sort(), provider, reason, checkId: await record(tx, input, { provider, outcome: status, reason, verdict }),
  });

  // 1. 反刷闸门：超限不创建评论，只留痕；由调用方在事务提交后返回 429，留痕才不会随回滚消失。
  const hourly = await checkRateLimit(tx, `comment:user:hour:${input.userId}`, limits.commentsPerUserPerHour, input.now);
  const daily = (await incrementDailyCounter(tx, `comment:user:day:${input.userId}`, input.now)) <= limits.commentsPerUserPerDay;
  const ipAllowed = input.ip && input.ip !== 'local' ? await checkRateLimit(tx, `comment:ip:hour:${input.ip}`, limits.commentsPerIpPerHour, input.now) : true;
  if (!hourly || !daily || !ipAllowed) return finish('rate_limited', [], 'local', 'rate_limited');

  // 2. 本地结构检查与突发 / 重复：不花钱就能判定的先判定。
  const structure = localStructureFlags(input.body);
  if (structure.length > 0) return finish('pending_review', ['spam'], 'local', 'local_structure');
  const recentWhere = [
    eq(communityComments.authorUserId, input.userId),
    inArray(communityComments.status, ['published', 'pending_review', 'rejected']),
    gte(communityComments.updatedAt, new Date(input.now.getTime() - 5 * 60 * 1000)),
  ];
  if (input.excludeCommentId) recentWhere.push(ne(communityComments.id, input.excludeCommentId));
  const recent = await tx.select({ body: communityComments.body }).from(communityComments)
    .where(and(...recentWhere)).orderBy(desc(communityComments.updatedAt)).limit(6);
  const normalized = normalizeCommentText(input.body);
  if (recent.some((row) => normalizeCommentText(row.body) === normalized)) return finish('pending_review', ['spam'], 'local', 'duplicate');
  if (recent.length >= 5) return finish('pending_review', ['spam'], 'local', 'burst');

  // 3. 同文缓存：相同内容在缓存期内沿用上一次真实判定，不重复计费。
  const hash = commentTextHash(input.body);
  if (limits.tmsCacheHours > 0) {
    const [cached] = await tx.select({ suggestion: commentModerationChecks.suggestion, label: commentModerationChecks.label, subLabel: commentModerationChecks.subLabel, score: commentModerationChecks.score, keywords: commentModerationChecks.keywords })
      .from(commentModerationChecks)
      .where(and(eq(commentModerationChecks.textHash, hash), eq(commentModerationChecks.provider, 'tencent-tms'), gte(commentModerationChecks.createdAt, new Date(input.now.getTime() - limits.tmsCacheHours * 60 * 60 * 1000))))
      .orderBy(desc(commentModerationChecks.createdAt)).limit(1);
    if (cached && (cached.suggestion === 'Pass' || cached.suggestion === 'Review' || cached.suggestion === 'Block')) {
      const status = decisionFor(cached.suggestion);
      const category = riskCategoryForLabel(cached.label ?? 'Normal');
      return finish(status, category ? [category] : [], 'cached', `cached_${cached.suggestion.toLowerCase() as 'pass' | 'review' | 'block'}`,
        { suggestion: cached.suggestion, label: cached.label ?? undefined, subLabel: cached.subLabel, score: cached.score, keywords: Array.isArray(cached.keywords) ? cached.keywords as string[] : [] });
    }
  }

  // 4. 服务未配置：全部待审。
  const credentials = deps.credentials === undefined ? resolveTmsCredentials() : deps.credentials;
  if (!credentials) return finish('pending_review', [], 'unavailable', 'provider_disabled');

  // 5. 日预算：超出后不再调用，评论进待审。
  const used = await incrementDailyCounter(tx, 'tms:budget', input.now);
  if (used > limits.tmsDailyBudget) return finish('pending_review', [], 'local', 'budget_exhausted');

  // 6. 真实调用。
  try {
    const dataId = `${hash.slice(0, 24)}-${input.now.getTime().toString(36)}`;
    const verdict = await (deps.moderate ?? ((creds, request) => moderateTextWithTms(creds, request, { fetcher: deps.fetcher, timeoutMs: limits.tmsTimeoutMs })))(credentials, {
      content: input.body, dataId, userToken: tmsUserToken(input.publicAuthorId),
    });
    health.consecutiveFailures = 0; health.lastSuccessAt = input.now;
    const status = decisionFor(verdict.suggestion);
    const category = riskCategoryForLabel(verdict.label);
    return finish(status, category ? [category] : [], 'tencent-tms', `tms_${verdict.suggestion.toLowerCase() as 'pass' | 'review' | 'block'}`, verdict);
  } catch (error) {
    health.consecutiveFailures += 1; health.lastErrorAt = input.now;
    health.lastErrorCode = error instanceof Error && 'code' in error && typeof (error as { code: unknown }).code === 'string' ? (error as { code: string }).code : 'UNKNOWN';
    return finish('pending_review', [], 'unavailable', 'provider_error');
  }
}

/** 日计数器：复用 rate_limits 表，窗口起点按上海日对齐。 */
async function incrementDailyCounter(tx: AnyDatabase, key: string, now: Date): Promise<number> {
  const { incrementRateLimit } = await import('@/../db/client');
  return incrementRateLimit(tx, key, dayWindowStart(now));
}

/** 今日用量（系统信息页）：真实调用 / 缓存命中 / 本地判定 / 服务失败。 */
export async function summarizeModerationToday(db: AnyDatabase, now: Date = new Date()) {
  const start = dayWindowStart(now);
  const rows = await db.select({ provider: commentModerationChecks.provider, outcome: commentModerationChecks.outcome, count: sql<number>`count(*)::int` })
    .from(commentModerationChecks).where(gte(commentModerationChecks.createdAt, start))
    .groupBy(commentModerationChecks.provider, commentModerationChecks.outcome);
  const total = (provider: ModerationProvider) => rows.filter((row) => row.provider === provider).reduce((sum, row) => sum + Number(row.count), 0);
  const outcome = (status: CommentDecisionStatus) => rows.filter((row) => row.outcome === status).reduce((sum, row) => sum + Number(row.count), 0);
  return {
    day: start.toISOString().slice(0, 10),
    calls: total('tencent-tms'), cached: total('cached'), local: total('local'), unavailable: total('unavailable'),
    published: outcome('published'), pendingReview: outcome('pending_review'), rejected: outcome('rejected'), rateLimited: outcome('rate_limited'),
    budget: config.moderation.tmsDailyBudget,
    enabled: resolveTmsCredentials() !== null,
    health: getModerationProviderHealth(),
  };
}

export { hourlyWindowStart };
