import { ApiError } from '@/lib/sync/clientAdapter';
import { zhCN } from '@/messages/zh-CN';

/** A timeout is an unknown write outcome, not proof that the server rejected it. */
export async function postCommunityCommand(url: string, key: string, payload: object): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? zhCN.communityAdmin.mineActions.requestFailed);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(zhCN.communityAdmin.mineActions.unknown);
    return body;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(zhCN.communityAdmin.mineActions.unknown);
    throw error;
  } finally { clearTimeout(timeout); }
}

export function isDefiniteCommunityRejection(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
}
