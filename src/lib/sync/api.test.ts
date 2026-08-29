// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDoupuApi } from './api';
import { ApiError } from './clientAdapter';
import type { ProjectFile } from '@/lib/types';

const minimalProject: ProjectFile = {
  format: 'doupu-project',
  version: 2,
  engineVersion: '2.0.0',
  name: '测试设计',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  palette: { kind: 'builtin', brand: 'MARD' },
  params: {
    targetWidth: 100,
    targetColorCount: 40,
    dithering: false,
    mode: 'dominant',
    brightness: 0,
    contrast: 0,
    backgroundRemoval: false,
    bgTolerance: 8,
  },
  pattern: {
    width: 1,
    height: 1,
    cells: [{ hex: '#FFFFFF', code: 'W', transparent: false }],
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createDoupuApi 云端设计接口', () => {
  it('listDesigns 成功返回列表', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createDoupuApi(async (input, init) => {
      calls.push({ url: String(input), init });
      return jsonResponse(200, {
        items: [{ id: 'd1', name: '设计一', width: 1, height: 1, updatedAt: '2026-01-01T00:00:00.000Z', deleted: false, revision: 1 }],
        nextCursor: null,
      });
    });
    const list = await api.listDesigns();
    expect(list).toHaveLength(1);
    expect(calls[0].url).toBe('/api/designs');
  });

  it('拒绝无 revision 的旧数组列表协议', async () => {
    const api = createDoupuApi(async () => jsonResponse(200, [{ id: 'legacy' }]));
    await expect(api.listDesigns()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('getDesign 404 返回 null，其他错误抛 ApiError', async () => {
    const notFound = createDoupuApi(async () => jsonResponse(404, {}));
    expect(await notFound.getDesign('x')).toBeNull();

    const serverErr = createDoupuApi(async () =>
      jsonResponse(500, { error: { code: 'DB_DOWN', message: '库挂了' } }),
    );
    await expect(serverErr.getDesign('x')).rejects.toMatchObject({
      status: 500,
      code: 'DB_DOWN',
      message: '库挂了',
    });
  });

  it('getDesign 成功返回完整设计', async () => {
    const api = createDoupuApi(async () =>
      jsonResponse(200, { id: 'd1', name: 'n', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1, project: minimalProject }),
    );
    const design = await api.getDesign('d1');
    expect(design?.project).toEqual({
      ...minimalProject,
      params: { ...minimalProject.params, backgroundPrototype: null },
    });
  });

  it('putDesign 携带 JSON Content-Type 并返回 updatedAt', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createDoupuApi(async (input, init) => {
      calls.push({ url: String(input), init });
      return jsonResponse(200, { updatedAt: '2026-02-02T00:00:00.000Z', revision: 1 });
    });
    const result = await api.putDesign('d1', '名字', minimalProject, 0);
    expect(result.updatedAt).toBe('2026-02-02T00:00:00.000Z');
    expect(calls[0].url).toBe('/api/designs/d1');
    expect(calls[0].init?.method).toBe('PUT');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('deleteDesign 404 静默成功（幂等），5xx 抛错', async () => {
    const ok = createDoupuApi(async () => new Response(null, { status: 204 }));
    await expect(ok.deleteDesign('d1', 1)).resolves.toEqual({ updatedAt: '', revision: 2 });

    const notFound = createDoupuApi(async () => new Response(null, { status: 404 }));
    await expect(notFound.deleteDesign('d1', 1)).resolves.toEqual({ updatedAt: '', revision: 2 });

    const boom = createDoupuApi(async () => jsonResponse(500, { error: { code: 'INTERNAL' } }));
    await expect(boom.deleteDesign('d1', 1)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('createDoupuApi 账号接口', () => {
  it('me：401→guest、403→unverified、200→verified', async () => {
    const guest = createDoupuApi(async () => jsonResponse(401, {}));
    expect(await guest.me()).toEqual({ state: 'guest' });

    const unverified = createDoupuApi(async () => jsonResponse(403, {}));
    expect(await unverified.me()).toEqual({ state: 'unverified' });

    const verified = createDoupuApi(async () =>
      jsonResponse(200, { email: 'a@b.c', username: '豆豆', createdAt: '2026-01-01T00:00:00Z' }),
    );
    expect(await verified.me()).toEqual({
      state: 'verified',
      email: 'a@b.c',
      username: '豆豆',
      createdAt: '2026-01-01T00:00:00Z',
    });
  });

  it('me：500 抛 ApiError（含 JSON 错误体的 code/field）', async () => {
    const api = createDoupuApi(async () =>
      jsonResponse(500, { error: { code: 'DB_DOWN', message: 'x', field: 'email' } }),
    );
    await expect(api.me()).rejects.toMatchObject({ status: 500, code: 'DB_DOWN', field: 'email' });
  });

  it('非 JSON 错误体：使用默认 code/message', async () => {
    const api = createDoupuApi(async () => new Response('oops', { status: 502 }));
    await expect(api.me()).rejects.toMatchObject({ status: 502, code: 'INTERNAL', message: '请求失败（502）' });
  });

  it('resendVerification 成功静默，失败抛错', async () => {
    const ok = createDoupuApi(async () => new Response(null, { status: 204 }));
    await expect(ok.resendVerification('a@b.c')).resolves.toBeUndefined();

    const tooMany = createDoupuApi(async () =>
      jsonResponse(429, { error: { code: 'RATE_LIMITED', message: '太频繁' } }),
    );
    await expect(tooMany.resendVerification('a@b.c')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('changePassword/updateProfile/deleteAccount/logout：成功静默、失败抛错、带 JSON 头', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createDoupuApi(async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(null, { status: 204 });
    });
    await api.changePassword('old', 'new');
    await api.updateProfile('豆豆');
    await api.deleteAccount('old');
    await api.logout();
    expect(calls.map((c) => c.url)).toEqual([
      '/api/auth/change-password',
      '/api/auth/account',
      '/api/auth/account',
      '/api/auth/logout',
    ]);
    for (const call of calls) {
      const headers = call.init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    }

    const fail = createDoupuApi(async () =>
      jsonResponse(401, { error: { code: 'BAD_PASSWORD', message: '密码错误' } }),
    );
    await expect(fail.changePassword('old', 'new')).rejects.toMatchObject({ code: 'BAD_PASSWORD' });
    await expect(fail.updateProfile('豆豆')).rejects.toMatchObject({ code: 'BAD_PASSWORD' });
    await expect(fail.deleteAccount('old')).rejects.toMatchObject({ code: 'BAD_PASSWORD' });
    await expect(fail.logout()).rejects.toMatchObject({ code: 'BAD_PASSWORD' });
  });

  it('GET 请求不强制添加 Content-Type', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createDoupuApi(async (input, init) => {
      calls.push({ url: String(input), init });
      return jsonResponse(200, { items: [], nextCursor: null });
    });
    await api.listDesigns();
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
  });
});
