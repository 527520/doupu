/**
 * 浏览器端 API 客户端（ticket 17）：designs 云同步 + 账号接口的 fetch 实现。
 * fetch 实现可注入（测试用假实现）；错误统一抛 ApiError（含 status/code/field）。
 */
import { ApiError, type CloudApi, type CloudDesignFull, type CloudDesignMeta, type CloudDesignPage } from './clientAdapter';
import type { ProjectFile } from '@/lib/types';
import { z } from 'zod';
import { projectFileSchema } from '@/lib/schemas';

export type MeInfo =
  | { state: 'guest' }
  | { state: 'verified'; email: string; createdAt: string }
  | { state: 'unverified' };

export interface AuthApi {
  me(): Promise<MeInfo>;
  resendVerification(email: string): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  deleteAccount(password: string): Promise<void>;
  logout(): Promise<void>;
}

export type DoupuApi = AuthApi & CloudApi & { listDesigns(): Promise<CloudDesignMeta[]> };

interface ErrorBody {
  error?: { code?: string; message?: string; field?: string };
}

const cloudDesignMetaSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  width: z.number().int().min(0),
  height: z.number().int().min(0),
  updatedAt: z.string().datetime(),
  deleted: z.boolean(),
  revision: z.number().int().positive(),
});
const cloudDesignPageSchema = z.object({
  items: z.array(cloudDesignMetaSchema),
  nextCursor: z.string().min(1).nullable(),
});
const cloudDesignFullSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  project: projectFileSchema,
  updatedAt: z.string().datetime(),
  revision: z.number().int().positive(),
  deleted: z.boolean().optional(),
});
const revisionResponseSchema = z.object({
  updatedAt: z.string().datetime(),
  revision: z.number().int().positive(),
});

function parseCloudResponse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new ApiError(502, 'INVALID_RESPONSE', '云端返回了不兼容的数据');
  return parsed.data;
}

async function throwFor(response: Response): Promise<never> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // 非 JSON 错误体
  }
  throw new ApiError(
    response.status,
    body.error?.code ?? 'INTERNAL',
    body.error?.message ?? `请求失败（${response.status}）`,
    body.error?.field,
  );
}

export function createDoupuApi(fetchImpl: typeof fetch = fetch) {
  async function request(path: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
    // 所有 mutating 方法都带 JSON 声明（含无 body 的 DELETE）：
    // 服务端 enforceMutatingGuard 要求 Content-Type: application/json，
    // 此前 bodyless DELETE 未带头导致被 400 拒绝 → 删除失败。
    if (init?.method && init.method !== 'GET') {
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    }
    return fetchImpl(path, { ...init, headers });
  }

  async function expectNoContent(path: string, body: unknown): Promise<void> {
    const response = await request(path, { method: 'POST', body: JSON.stringify(body) });
    if (response.ok) return;
    await throwFor(response);
  }

  const cloudApi = {
    async listDesignsPage(cursor?: string): Promise<CloudDesignPage> {
      const response = await request(cursor ? `/api/designs?cursor=${encodeURIComponent(cursor)}` : '/api/designs');
      if (!response.ok) await throwFor(response);
      return parseCloudResponse(cloudDesignPageSchema, await response.json());
    },
    async listDesigns(): Promise<CloudDesignMeta[]> {
      const rows: CloudDesignMeta[] = [];
      let cursor: string | undefined;
      do {
        const page = await cloudApi.listDesignsPage(cursor);
        rows.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return rows;
    },
    async getDesign(id: string): Promise<CloudDesignFull | null> {
      const response = await request(`/api/designs/${id}`);
      if (response.status === 404) return null;
      if (!response.ok) await throwFor(response);
      return parseCloudResponse(cloudDesignFullSchema, await response.json());
    },
    async putDesign(id: string, name: string, project: ProjectFile, baseRevision: number): Promise<{ updatedAt: string; revision: number }> {
      const response = await request(`/api/designs/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, project, baseRevision }),
      });
      if (!response.ok) await throwFor(response);
      return parseCloudResponse(revisionResponseSchema, await response.json());
    },
    async deleteDesign(id: string, baseRevision: number): Promise<{ updatedAt: string; revision: number }> {
      const response = await request(`/api/designs/${id}`, { method: 'DELETE', body: JSON.stringify({ baseRevision }) });
      if (response.status === 204 || response.status === 404) return { updatedAt: '', revision: baseRevision + 1 };
      if (!response.ok) await throwFor(response);
      return parseCloudResponse(revisionResponseSchema, await response.json());
    },
  };

  const authApi: AuthApi = {
    async me(): Promise<MeInfo> {
      const response = await request('/api/auth/me');
      if (response.status === 401) return { state: 'guest' };
      if (response.status === 403) return { state: 'unverified' };
      if (!response.ok) await throwFor(response);
      const data = (await response.json()) as { email: string; createdAt: string };
      return { state: 'verified', email: data.email, createdAt: data.createdAt };
    },
    async resendVerification(email: string): Promise<void> {
      const response = await request('/api/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      if (!response.ok) await throwFor(response);
    },
    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
      await expectNoContent('/api/auth/change-password', { currentPassword, newPassword });
    },
    async deleteAccount(password: string): Promise<void> {
      const response = await request('/api/auth/account', {
        method: 'DELETE',
        body: JSON.stringify({ password }),
      });
      if (!response.ok) await throwFor(response);
    },
    async logout(): Promise<void> {
      const response = await request('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
      if (!response.ok) await throwFor(response);
    },
  };

  return { ...cloudApi, ...authApi };
}
