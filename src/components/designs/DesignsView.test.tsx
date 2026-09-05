// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DesignsView from './DesignsView';
import { ApiError, type CloudDesignFull } from '@/lib/sync/clientAdapter';
import { enqueueBackgroundSync, hasPendingSync } from '@/lib/sync/queue';
import { createStitchProgress, type StitchProgress } from '@/lib/progress/stitchProgress';
import type { DoupuApi, MeInfo } from '@/lib/sync/api';
import type { DesignRecord, StorageAdapter } from '@/lib/storage';
import type { ProjectFile } from '@/lib/types';

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));

// 时间戳一律相对真实时钟（避免系统时钟与固定 fixture 日期不一致导致 LWW 反转）
const NOW = Date.now();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function makeProject(name: string, updatedAt: string): ProjectFile {
  return {
    format: 'doupu-project',
    version: 3,
    engineVersion: '2.0.0',
    boardProfile: '5mm-29',
    name,
    createdAt: updatedAt,
    updatedAt,
    paletteSelection: {
      palette: { kind: 'builtin', brand: 'MARD' },
      kitTier: 0,
    },
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
      cells: Array.from({ length: 600 }, () => ({ hex: '#FC3D46', code: 'F02', transparent: false })),
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
  readonly progress = new Map<string, StitchProgress>();
  async getStitchProgress(designId: string) {
    return this.progress.get(designId) ?? null;
  }
  async putStitchProgress(designId: string, value: StitchProgress) {
    this.progress.set(designId, value);
  }
  async deleteStitchProgress(designId: string) {
    this.progress.delete(designId);
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
  async updateProfile() {
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
  beforeEach(() => navigation.push.mockClear());
  it.each(['edit', 'stitch'] as const)('整张设计卡片一次点击，在本地确认图纸和进度后进入 %s', async (mode) => {
    const project = makeProject('继续这张', iso(-1000));
    const storage = new FakeStorage([localRecord('resume-1', project)]);
    if (mode === 'stitch') {
      const progress = createStitchProgress(30, 20); progress.done[0] = 1;
      storage.progress.set('resume-1', progress);
    }
    render(<DesignsView storageOverride={storage} apiOverride={new FakeApi()} />);
    fireEvent.click(await screen.findByRole('button', { name: '继续制作：继续这张' }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/app?id=resume-1&mode=${mode}`));
  });

  it('打开时本地读取失败不会下载覆盖或跳入空白工作台', async () => {
    const project = makeProject('保留原件', iso(-1000));
    const storage = new FakeStorage([localRecord('keep', project)]);
    const api = new FakeApi();
    render(<DesignsView storageOverride={storage} apiOverride={api} />);
    const open = await screen.findByRole('button', { name: '继续制作：保留原件' });
    const pull = vi.spyOn(api, 'getDesign');
    vi.spyOn(storage, 'getAll').mockRejectedValue(new Error('storage unavailable'));
    fireEvent.click(open);
    expect(await screen.findByText('暂时无法打开这张设计，原有数据未改动。请重试。')).toBeVisible();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(pull).not.toHaveBeenCalled();
    expect(storage.records.has('keep')).toBe(true);
  });

  it('损坏的本地记录不会被静默替换或作为有效图纸打开', async () => {
    const storage = new FakeStorage([{ id: 'broken', name: '损坏记录', thumbnail: null, projectJson: '{}', updatedAt: iso(-1000) }]);
    render(<DesignsView storageOverride={storage} apiOverride={new FakeApi()} />);
    fireEvent.click(await screen.findByRole('button', { name: '继续制作：损坏记录' }));
    expect(await screen.findByText('暂时无法打开这张设计，原有数据未改动。请重试。')).toBeVisible();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(storage.records.get('broken')?.projectJson).toBe('{}');
  });

  it('列表读取失败不显示没有设计，并可重试恢复', async () => {
    const storage = new FakeStorage([localRecord('retry', makeProject('真实记录', iso(-1000)))]);
    vi.spyOn(storage, 'getAll').mockRejectedValueOnce(new Error('read failed'));
    render(<DesignsView storageOverride={storage} apiOverride={new FakeApi()} />);
    expect(await screen.findByText('加载失败，请重试。')).toBeVisible();
    expect(screen.queryByText('还没有设计')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('真实记录')).toBeVisible();
  });

  it('首次加载时显示 live region，且不提前显示空态', () => {
    render(<DesignsView storageOverride={new FakeStorage()} apiOverride={new FakeApi()} />);
    expect(screen.getByRole('status')).toHaveTextContent('正在加载设计…');
    expect(screen.queryByText('还没有设计')).toBeNull();
  });

  it('云端图纸确认下载成功前不跳转；失败后可再次打开且不重复导航', async () => {
    const project = makeProject('云端原件', iso(-1000));
    const api = new FakeApi([{ id: 'cloud-only', name: project.name, project, updatedAt: project.updatedAt }]);
    api.meState = { state: 'verified', email: 'a@b.com', username: null, createdAt: iso(-86400000) };
    api.listDesignsPage = async () => { throw new Error('initial sync failed'); };
    const storage = new FakeStorage();
    render(<DesignsView storageOverride={storage} apiOverride={api} />);
    const open = await screen.findByRole('button', { name: '继续制作：云端原件' });
    vi.spyOn(api, 'getDesign').mockRejectedValueOnce(new Error('download failed'));
    fireEvent.click(open);
    expect(await screen.findByText('暂时无法打开这张设计，原有数据未改动。请重试。')).toBeVisible();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(storage.records.size).toBe(0);
    fireEvent.click(open);
    fireEvent.click(open);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/app?id=cloud-only&mode=edit'));
    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(storage.records.get('cloud-only')?.projectJson).toContain('云端原件');
  });

  it('读取跟拼进度失败时不误跳编辑，重试后保留原有进度', async () => {
    const project = makeProject('已有进度', iso(-1000));
    const storage = new FakeStorage([localRecord('progress', project)]);
    const progress = createStitchProgress(30, 20); progress.done[10] = 1;
    storage.progress.set('progress', progress);
    vi.spyOn(storage, 'getStitchProgress').mockRejectedValueOnce(new Error('read progress failed'));
    render(<DesignsView storageOverride={storage} apiOverride={new FakeApi()} />);
    const open = await screen.findByRole('button', { name: '继续制作：已有进度' });
    fireEvent.click(open);
    expect(await screen.findByText('暂时无法打开这张设计，原有数据未改动。请重试。')).toBeVisible();
    expect(navigation.push).not.toHaveBeenCalled();
    fireEvent.click(open);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/app?id=progress&mode=stitch'));
    expect(storage.progress.get('progress')?.done[10]).toBe(1);
  });

  it('管理菜单按需展示操作，关闭弹窗后键盘回到可见入口', async () => {
    const user = userEvent.setup();
    render(<DesignsView storageOverride={new FakeStorage([localRecord('focus', makeProject('焦点图纸', iso(-1000)))])} apiOverride={new FakeApi()} />);
    const manage = await screen.findByRole('button', { name: '管理：焦点图纸' });
    expect(screen.queryByRole('button', { name: '重命名' })).not.toBeInTheDocument();
    await user.click(manage);
    await user.click(screen.getByRole('button', { name: '重命名' }));
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(manage).toHaveFocus();
  });

  it('删除请求失败在弹窗中可见，保留原件与再次确认，连续点击只发一次', async () => {
    const project = makeProject('删除保护', iso(-1000));
    const api = new FakeApi([{ id: 'safe-delete', name: project.name, project, updatedAt: project.updatedAt }]);
    api.meState = { state: 'verified', email: 'a@b.com', username: null, createdAt: iso(-86400000) };
    const storage = new FakeStorage();
    render(<DesignsView storageOverride={storage} apiOverride={api} />);
    fireEvent.click(await screen.findByRole('button', { name: '管理：删除保护' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    const remove = vi.spyOn(api, 'deleteDesign').mockRejectedValueOnce(new Error('offline'));
    const confirm = screen.getByRole('button', { name: '删除' });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(await screen.findByRole('alert')).toHaveTextContent('加载失败，请重试。');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(storage.records.has('safe-delete')).toBe(true);
    expect(api.cloud.has('safe-delete')).toBe(true);
    expect(screen.getByRole('dialog')).toBeVisible();
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(storage.records.has('safe-delete')).toBe(false));
  });

  it('游客态：显示登录引导与本机设计（仅本机角标）', async () => {
    const project = makeProject('本机设计', iso(-7200_000));
    const storage = new FakeStorage([localRecord('l1', project)]);
    render(<DesignsView storageOverride={storage} apiOverride={new FakeApi()} />);

    await screen.findByText('本机设计');
    expect(screen.getByText(/未登录：仅显示本机设计/)).toBeTruthy();
    expect(screen.getByText('仅本机')).toBeTruthy();
    expect(screen.getByText('本地：已保存')).toBeTruthy();
    expect(screen.getByRole('link', { name: '去登录' })).toBeTruthy();
  });

  it('已登录：本地与云端设计完成同步后均为已同步', async () => {
    const cloudProject = makeProject('云端设计', iso(-3600_000));
    const api = new FakeApi([{ id: 'c1', name: '云端设计', project: cloudProject, updatedAt: cloudProject.updatedAt }]);
    api.meState = { state: 'verified', email: 'a@b.com', username: null, createdAt: iso(-86400_000) };
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
    api.meState = { state: 'verified', email: 'a@b.com', username: null, createdAt: iso(-86400_000) };
    render(<DesignsView storageOverride={storage} apiOverride={api} />);

    await screen.findByText('离线设计');
    await waitFor(async () => expect(await hasPendingSync(storage)).toBe(false));
    expect(api.cloud.has('offline-1')).toBe(true);
  });

  it('冲突：云端较新覆盖本地，显示冲突角标与提示条', async () => {
    const cloudProject = makeProject('云端新版', iso(-1000));
    const api = new FakeApi([{ id: 'k1', name: '云端新版', project: cloudProject, updatedAt: cloudProject.updatedAt, revision: 2 }]);
    api.meState = { state: 'verified', email: 'a@b.com', username: null, createdAt: iso(-86400_000) };
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
    api.meState = { state: 'verified', email: 'a@b.com', username: null, createdAt: iso(-86400_000) };
    const storage = new FakeStorage([localRecord('r1', project)]);
    render(<DesignsView storageOverride={storage} apiOverride={api} />);

    await screen.findByText('旧名');
    fireEvent.click(screen.getByRole('button', { name: '管理：旧名' }));
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
    api.meState = { state: 'verified', email: 'a@b.com', username: null, createdAt: iso(-86400_000) };
    const storage = new FakeStorage([localRecord('d1', project)]);
    render(<DesignsView storageOverride={storage} apiOverride={api} />);

    await screen.findByText('待删');
    fireEvent.click(screen.getByRole('button', { name: '管理：待删' }));
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
    api.meState = { state: 'verified', email: 'a@b.com', username: null, createdAt: iso(-86400_000) };
    api.listDesignsPage = async () => ({ items: [], nextCursor: null });
    api.putDesign = async () => { throw new TypeError('previous page is still syncing'); };
    const storage = new FakeStorage([localRecord('race-delete', project)]);
    render(<DesignsView storageOverride={storage} apiOverride={api} />);

    await screen.findByText('竞态设计');
    fireEvent.click(screen.getByRole('button', { name: '管理：竞态设计' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(api.deleted).toContain('race-delete'));
    expect(await storage.getAll()).toEqual([]);
  });

  it('云端失败：保留本地列表并显示同步失败提示', async () => {
    const project = makeProject('本地设计', iso(-7200_000));
    const api = new FakeApi();
    api.meState = { state: 'verified', email: 'a@b.com', username: null, createdAt: iso(-86400_000) };
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
