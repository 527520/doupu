// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DesignsView from './DesignsView';
import { ApiError, type CloudDesignFull } from '@/lib/sync/clientAdapter';
import { enqueueBackgroundSync, hasPendingSync } from '@/lib/sync/queue';
import type { DoupuApi, MeInfo } from '@/lib/sync/api';
import type { DesignRecord, StorageAdapter } from '@/lib/storage';
import type { ProjectFile } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// 时间戳一律相对真实时钟（避免系统时钟与固定 fixture 日期不一致导致 LWW 反转）
const NOW = Date.now();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function makeProject(name: string, updatedAt: string): ProjectFile {
  return {
    format: 'doupu-project',
    version: 2,
    engineVersion: '2.0.0',
    name,
    createdAt: updatedAt,
    updatedAt,
    palette: { kind: 'builtin', brand: 'MARD' },
    params: {
      targetWidth: 20,
      targetColorCount: 40,
      dithering: false,
      mode: 'dominant',
      brightness: 0,
      contrast: 0,
      backgroundRemoval: false,
      bgTolerance: 8,
    },
    pattern: {
      width: 30,
      height: 20,
      cells: Array.from({ length: 600 }, () => ({ hex: '#FF0000', code: 'F02', transparent: false })),
    },
  };
}

class FakeStorage implements StorageAdapter {
  records = new Map<string, DesignRecord>();
  meta = new Map<string, string>();
  constructor(entries: DesignRecord[] = []) {
    for (const entry of entries) this.records.set(entry.id, entry);
  }
  async getAll() {
    return [...this.records.values()];
  }
  async getGenerationSource() {
    return null;
  }
  async put(r: DesignRecord) {
    this.records.set(r.id, { ...r });
  }
  async delete(id: string) {
    this.records.delete(id);
  }
  async getMeta(key: string) {
    return this.meta.get(key) ?? null;
  }
  async setMeta(key: string, value: string) {
    this.meta.set(key, value);
  }
}

class FakeApi implements DoupuApi {
  meState: MeInfo = { state: 'guest' };
  cloud = new Map<string, CloudDesignFull>();
  deleted: string[] = [];
  resendCalls: string[] = [];
  logoutCalls = 0;
  failCloud = false;

  constructor(entries: Array<Omit<CloudDesignFull, 'revision'> & { revision?: number }> = []) {
    for (const entry of entries) this.cloud.set(entry.id, { ...entry, revision: entry.revision ?? 1 });
  }
  async me() {
    return this.meState;
  }
  async listDesigns() {
    if (this.failCloud) throw new ApiError(500, 'INTERNAL', '网络错误');
    return [...this.cloud.values()].map((d) => ({
      id: d.id,
      name: d.name,
      width: d.project.pattern.width,
      height: d.project.pattern.height,
      updatedAt: d.updatedAt,
      deleted: d.deleted ?? false,
      revision: d.revision ?? 1,
    }));
  }
  async listDesignsPage() {
    return { items: await this.listDesigns(), nextCursor: null };
  }
  async getDesign(id: string) {
    return this.cloud.get(id) ?? null;
  }
  async putDesign(id: string, name: string, project: ProjectFile, baseRevision: number) {
    const current = this.cloud.get(id);
    if ((current?.revision ?? 0) !== baseRevision) throw new ApiError(409, 'REVISION_CONFLICT', 'conflict');
    const updatedAt = new Date(Date.parse(project.updatedAt) + 1000).toISOString();
    const revision = baseRevision + 1;
    this.cloud.set(id, { id, name, project: { ...project, updatedAt }, updatedAt, revision });
    return { updatedAt, revision };
  }
  async deleteDesign(id: string, baseRevision: number) {
    const current = this.cloud.get(id);
    if (!current || (current.revision ?? 1) !== baseRevision) throw new ApiError(409, 'REVISION_CONFLICT', 'conflict');
    this.deleted.push(id);
    this.cloud.delete(id);
    return { updatedAt: iso(0), revision: baseRevision + 1 };
  }
  async resendVerification(email: string) {
    this.resendCalls.push(email);
  }
  async changePassword() {
    // no-op
  }
  async deleteAccount() {
    // no-op
  }
  async logout() {
    this.logoutCalls++;
  }
}

function localRecord(id: string, project: ProjectFile, revision = 0, syncState: DesignRecord['syncState'] = 'dirty'): DesignRecord {
  return { id, name: project.name, projectJson: JSON.stringify(project), thumbnail: null, updatedAt: project.updatedAt, revision, syncState };
}

describe('DesignsView', () => {
  it('首次加载时显示 live region，且不提前显示空态', () => {
    render(<DesignsView storageOverride={new FakeStorage()} apiOverride={new FakeApi()} />);
    expect(screen.getByRole('status')).toHaveTextContent('正在加载设计…');
    expect(screen.queryByText('还没有设计')).toBeNull();
  });

  it('游客态：显示登录引导与本机设计（仅本机角标）', async () => {
    const project = makeProject('本机设计', iso(-7200_000));
    const storage = new FakeStorage([localRecord('l1', project)]);
    render(<DesignsView storageOverride={storage} apiOverride={new FakeApi()} />);

    await screen.findByText('本机设计');
    expect(screen.getByText(/未登录：仅显示本机设计/)).toBeTruthy();
    expect(screen.getByText('仅本机')).toBeTruthy();
    expect(screen.getByText('本地：已保存')).toBeTruthy();
    expect(screen.getByRole('link', { name: '登录' })).toBeTruthy();
  });

  it('已登录：本地与云端设计完成同步后均为已同步', async () => {
    const cloudProject = makeProject('云端设计', iso(-3600_000));
    const api = new FakeApi([{ id: 'c1', name: '云端设计', project: cloudProject, updatedAt: cloudProject.updatedAt }]);
    api.meState = { state: 'verified', email: 'a@b.com', createdAt: iso(-86400_000) };
    const localProject = makeProject('本地新改', iso(-600_000));
    const storage = new FakeStorage([localRecord('l1', localProject)]);
    render(<DesignsView storageOverride={storage} apiOverride={api} />);

    await screen.findByText('本地新改');
    // 同步完成后：本地设计已推送并对齐服务端时间戳，云端设计已拉取，两者均为已同步
    expect(screen.getByText('云端设计')).toBeTruthy();
    expect(screen.getAllByText('已同步')).toHaveLength(2);
    expect(screen.getAllByText('本地：已保存')).toHaveLength(2);
    expect(api.cloud.has('l1')).toBe(true);
  });

  it('离线保存留下的待同步标记，会在下次页面启动同步成功后清除', async () => {
    const project = makeProject('离线设计', iso(-600_000));
    const storage = new FakeStorage([localRecord('offline-1', project)]);
    await expect(enqueueBackgroundSync(storage, async () => {
      throw new TypeError('offline');
    })).rejects.toThrow('offline');
    expect(await hasPendingSync(storage)).toBe(true);

    const api = new FakeApi();
    api.meState = { state: 'verified', email: 'a@b.com', createdAt: iso(-86400_000) };
    render(<DesignsView storageOverride={storage} apiOverride={api} />);

    await screen.findByText('离线设计');
    await waitFor(async () => expect(await hasPendingSync(storage)).toBe(false));
    expect(api.cloud.has('offline-1')).toBe(true);
  });

  it('冲突：云端较新覆盖本地，显示冲突角标与提示条', async () => {
    const cloudProject = makeProject('云端新版', iso(-1000));
    const api = new FakeApi([{ id: 'k1', name: '云端新版', project: cloudProject, updatedAt: cloudProject.updatedAt, revision: 2 }]);
    api.meState = { state: 'verified', email: 'a@b.com', createdAt: iso(-86400_000) };
    const localProject = makeProject('本地旧版', iso(-2000));
    const storage = new FakeStorage([localRecord('k1', localProject, 1, 'dirty')]);
    render(<DesignsView storageOverride={storage} apiOverride={api} />);

    await screen.findByText(/有 1 个设计发生版本冲突/);
    expect(screen.getAllByText('已在其他设备更新').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('云端新版')).toBeTruthy();
    expect(screen.getByText('本地旧版 (冲突副本)')).toBeTruthy();
  });

  it('重命名：更新本地并推送云端', async () => {
    const project = makeProject('旧名', iso(-3600_000));
    const api = new FakeApi();
    api.meState = { state: 'verified', email: 'a@b.com', createdAt: iso(-86400_000) };
    const storage = new FakeStorage([localRecord('r1', project)]);
    render(<DesignsView storageOverride={storage} apiOverride={api} />);

    await screen.findByText('旧名');
    fireEvent.click(screen.getByRole('button', { name: '重命名' }));
    const input = screen.getByLabelText('设计名称');
    fireEvent.change(input, { target: { value: '新名' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(screen.getByText('新名')).toBeTruthy());
    await waitFor(() => expect(api.cloud.get('r1')?.name).toBe('新名'));
  });

  it('删除：确认后本地墓碑 + 云端删除', async () => {
    const project = makeProject('待删', iso(-3600_000));
    const api = new FakeApi();
    api.meState = { state: 'verified', email: 'a@b.com', createdAt: iso(-86400_000) };
    const storage = new FakeStorage([localRecord('d1', project)]);
    render(<DesignsView storageOverride={storage} apiOverride={api} />);

    await screen.findByText('待删');
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(screen.getByText(/确定删除/)).toBeTruthy();
    // Modal 会将背景 inert；此时可访问树里只剩弹窗内的确认按钮。
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(screen.queryByText('待删')).toBeNull());
    expect(api.deleted).toContain('d1');
  });

  it('列表状态暂时仅本地但云端已存在时，删除前探测 revision 并删除云端原件', async () => {
    const project = makeProject('竞态设计', iso(-3600_000));
    const api = new FakeApi([{ id: 'race-delete', name: project.name, project, updatedAt: project.updatedAt, revision: 1 }]);
    api.meState = { state: 'verified', email: 'a@b.com', createdAt: iso(-86400_000) };
    api.listDesignsPage = async () => ({ items: [], nextCursor: null });
    api.putDesign = async () => { throw new TypeError('previous page is still syncing'); };
    const storage = new FakeStorage([localRecord('race-delete', project)]);
    render(<DesignsView storageOverride={storage} apiOverride={api} />);

    await screen.findByText('竞态设计');
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(api.deleted).toContain('race-delete'));
    expect(await storage.getAll()).toEqual([]);
  });

  it('云端失败：保留本地列表并显示同步失败提示', async () => {
    const project = makeProject('本地设计', iso(-7200_000));
    const api = new FakeApi();
    api.meState = { state: 'verified', email: 'a@b.com', createdAt: iso(-86400_000) };
    api.failCloud = true;
    const storage = new FakeStorage([localRecord('l1', project)]);
    render(<DesignsView storageOverride={storage} apiOverride={api} />);

    await screen.findByText('本地设计');
    expect(screen.getByText('同步失败，已保留本地数据。')).toBeTruthy();
  });

  it('空态：无设计时显示引导', async () => {
    render(<DesignsView storageOverride={new FakeStorage()} apiOverride={new FakeApi()} />);
    await screen.findByText('还没有设计');
    expect(screen.getByRole('link', { name: '新建设计' })).toBeTruthy();
  });
});
