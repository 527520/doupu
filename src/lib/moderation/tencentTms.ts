/**
 * 腾讯云文本内容安全（TMS）`TextModeration` 适配器（D50）。
 *
 * - 接口：tms.tencentcloudapi.com，Version 2020-12-29，Content 为 UTF-8 文本的 Base64。
 * - 只上送评论正文、一个不可逆的用户哈希与我们自己的记录 ID；不上送邮箱、内部 userId 或 IP。
 * - 返回值只保留处置建议、标签、置信度、命中词与 RequestId 供审计；其余字段丢弃。
 * - 任何网络 / 鉴权 / 限流错误都以 TmsError 上抛，由评论审核层决定兜底（进待审）。
 */
import { createHash } from 'node:crypto';
import { buildTc3Request } from '@/lib/tencent/sign';

export const TMS_SERVICE = 'tms';
export const TMS_HOST = 'tms.tencentcloudapi.com';
export const TMS_VERSION = '2020-12-29';
export const TMS_ACTION = 'TextModeration';
/** 接口限制 10,000 字符；评论上限 500，这里只是兜底。 */
export const TMS_MAX_CHARS = 10_000;

export type TmsSuggestion = 'Pass' | 'Review' | 'Block';

export interface TmsCredentials {
  secretId: string;
  secretKey: string;
  region: string;
  /** 控制台策略编号；空则用默认策略。 */
  bizType?: string;
}

export interface TmsVerdict {
  suggestion: TmsSuggestion;
  label: string;
  subLabel: string | null;
  score: number | null;
  keywords: string[];
  requestId: string | null;
  latencyMs: number;
}

export class TmsError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) {
    super(message);
    this.name = 'TmsError';
  }
}

interface TmsResponseBody {
  Response?: {
    Error?: { Code: string; Message: string };
    RequestId?: string;
    Suggestion?: string;
    Label?: string;
    SubLabel?: string;
    Score?: number;
    Keywords?: string[] | null;
  };
}

/** 对外用户标识：公开作者 ID 的 SHA-256 前缀，稳定但不可反查。 */
export function tmsUserToken(publicAuthorId: string): string {
  return createHash('sha256').update(`doupu:tms:${publicAuthorId}`, 'utf8').digest('hex').slice(0, 32);
}

export function buildTmsRequest(creds: TmsCredentials, input: { content: string; dataId: string; userToken?: string }, now: Date = new Date()) {
  const content = input.content.slice(0, TMS_MAX_CHARS);
  const payload = JSON.stringify({
    Content: Buffer.from(content, 'utf8').toString('base64'),
    ...(creds.bizType ? { BizType: creds.bizType } : {}),
    DataId: input.dataId.replace(/[^A-Za-z0-9_@#-]/gu, '-').slice(0, 64),
    Type: 'TEXT',
    SourceLanguage: 'zh',
    ...(input.userToken ? { User: { UserId: input.userToken } } : {}),
  });
  return buildTc3Request({
    service: TMS_SERVICE, host: TMS_HOST, action: TMS_ACTION, version: TMS_VERSION,
    region: creds.region, secretId: creds.secretId, secretKey: creds.secretKey, payload, now,
  });
}

export async function moderateTextWithTms(
  creds: TmsCredentials,
  input: { content: string; dataId: string; userToken?: string },
  options: { fetcher?: typeof fetch; timeoutMs?: number; now?: () => Date } = {},
): Promise<TmsVerdict> {
  const started = Date.now();
  const { url, headers, body } = buildTmsRequest(creds, input, options.now?.());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 3000);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url, { method: 'POST', headers, body, signal: controller.signal });
  } catch (error) {
    throw new TmsError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK', error instanceof Error ? error.message : 'network failure');
  } finally {
    clearTimeout(timer);
  }
  const parsed = (await response.json().catch(() => null)) as TmsResponseBody | null;
  const error = parsed?.Response?.Error;
  if (!response.ok || error || !parsed?.Response) {
    throw new TmsError(error?.Code ?? `HTTP_${response.status}`, error?.Message ?? 'TextModeration failed', response.status);
  }
  const { Suggestion, Label, SubLabel, Score, Keywords, RequestId } = parsed.Response;
  if (Suggestion !== 'Pass' && Suggestion !== 'Review' && Suggestion !== 'Block') {
    throw new TmsError('INVALID_RESPONSE', `unexpected suggestion ${String(Suggestion)}`, response.status);
  }
  return {
    suggestion: Suggestion,
    label: Label ?? 'Normal',
    subLabel: SubLabel || null,
    score: typeof Score === 'number' ? Score : null,
    keywords: Array.isArray(Keywords) ? Keywords.filter((item): item is string => typeof item === 'string').slice(0, 20) : [],
    requestId: RequestId ?? null,
    latencyMs: Date.now() - started,
  };
}

export function resolveTmsCredentials(env: Record<string, string | undefined> = process.env): TmsCredentials | null {
  if (env.TMS_ENABLED === 'false' || env.TMS_ENABLED === '0') return null;
  const secretId = env.TMS_SECRET_ID ?? env.SES_SECRET_ID;
  const secretKey = env.TMS_SECRET_KEY ?? env.SES_SECRET_KEY;
  const region = env.TMS_REGION ?? 'ap-guangzhou';
  if (!secretId || !secretKey) return null;
  return { secretId, secretKey, region, bizType: env.TMS_BIZ_TYPE || undefined };
}
