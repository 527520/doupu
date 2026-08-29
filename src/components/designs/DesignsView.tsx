'use client';

/** 我的设计列表页（ticket 17）：本地 + 云端设计网格、同步角标、重命名/删除、账号菜单。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';
import { createDoupuApi, type DoupuApi, type MeInfo } from '@/lib/sync/api';
import { createSyncClient, type CloudDesignMeta, type SyncClient } from '@/lib/sync/clientAdapter';
import { enqueueDesignSync, withDesignStorageLock } from '@/lib/sync/queue';
import { openIndexedDb, parseStoredProject, type DesignRecord, type StorageAdapter } from '@/lib/storage';
import type { PatternCell } from '@/lib/types';
import Notice from '@/components/ui/Notice';
import ColorBand from '@/components/palettes/ColorBand';
import { LIMITS } from '@/lib/appInfo';
import SiteHeader from '@/components/layout/SiteHeader';
import Modal from '@/components/ui/Modal';
import { fillDeleteHint, formatDateTime } from './format';

export interface DisplayDesign {
  id: string;
  name: string;
  width: number;
  height: number;
  updatedAt: string;
  thumbnail: string | null;
  /** 用色概览（E-3）：按用量降序的 hex，仅本地有项目数据时可得。 */
  colors: string[];
  revision: number;
  localPresent: boolean;
  cloudPresent: boolean;
  status: 'synced' | 'unsynced' | 'localOnly' | 'conflict';
}

interface Props {
  storageOverride?: StorageAdapter | null;
  apiOverride?: DoupuApi;
}

const t = zhCN.designs;

/**
 * 图纸用色概览（E-3）：按用量降序取前若干色。
 * 缩略图能看出「长什么样」，但看不出「要用哪些豆子」——挑今天拼哪一张时，
 * 用色比缩略图更常是决定因素（比如「今天只想拼粉色系那张」）。
 */
function topColors(cells: readonly PatternCell[], max = 12): string[] {
  const counts = new Map<string, number>();
  for (const cell of cells) {
    if (cell.transparent || cell.external || !cell.hex) continue;
    counts.set(cell.hex, (counts.get(cell.hex) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
    .slice(0, max)
    .map(([hex]) => hex);
}

function buildDisplay(
  local: DesignRecord[],
  cloud: CloudDesignMeta[],
  meInfo: MeInfo,
  conflicts: string[],
): DisplayDesign[] {
  const map = new Map<string, DisplayDesign>();
  for (const meta of cloud) {
    // 云端墓碑只参与同步 LWW，不显示在列表里
    if (meta.deleted) continue;
    map.set(meta.id, { ...meta, thumbnail: null, colors: [], status: 'synced', localPresent: false, cloudPresent: true });
  }
  for (const record of local) {
    const project = parseStoredProject(record.projectJson);
    const cloudEntry = map.get(record.id);
    let status: DisplayDesign['status'];
    if (conflicts.includes(record.id) || record.syncState === 'conflict') status = 'conflict';
    else if (!cloudEntry) status = meInfo.state === 'guest' ? 'localOnly' : 'unsynced';
    else if (record.syncState === 'dirty') status = 'unsynced';
    else status = 'synced';
    map.set(record.id, {
      id: record.id,
      name: record.name,
      width: project?.pattern.width ?? 0,
      height: project?.pattern.height ?? 0,
      updatedAt: record.updatedAt,
      thumbnail: record.thumbnail,
      colors: project ? topColors(project.pattern.cells) : [],
      revision: Math.max(record.revision ?? 0, cloudEntry?.revision ?? 0),
      localPresent: true,
      cloudPresent: Boolean(cloudEntry),
      status,
    });
  }
  return [...map.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export default function DesignsView({ storageOverride, apiOverride }: Props) {
  const router = useRouter();
  const [api] = useState<DoupuApi>(() => apiOverride ?? createDoupuApi());
  const [storage, setStorage] = useState<StorageAdapter | null | undefined>(undefined);
  const [syncClient, setSyncClient] = useState<SyncClient | null>(null);
  const [me, setMe] = useState<MeInfo | 'loading'>('loading');
  const [designs, setDesigns] = useState<DisplayDesign[]>([]);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cloudFailed, setCloudFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [renaming, setRenaming] = useState<DisplayDesign | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<DisplayDesign | null>(null);
  /** 未删除的设计数：达上限时先提示，避免用户新建后在保存阶段才撞墙（D-4）。 */
  const activeDesignCount = designs.length;

  const load = useCallback(async () => {
    // StrictMode 安全：取消守卫——dev 双调用 effect 时第一次被 cleanup 取消，第二次正常完成；
    // 避免两个 load 并发交错执行 sync 造成重复推送/墓碑竞争。
    const cancelled = { value: false };
    loadCancelRef.current = cancelled;
    setError(null);
    setCloudFailed(false);
    setSyncing(true);
    try {
      const st = storageOverride !== undefined ? storageOverride : await openIndexedDb().catch(() => null);
      if (cancelled.value) return;
      setStorage(st);
      const client = st ? createSyncClient(st, api) : null;
      setSyncClient(client);

      const [meInfo, localRecords] = await Promise.all([
        api.me().catch((): MeInfo => ({ state: 'guest' })),
        st ? st.getAll().catch(() => [] as DesignRecord[]) : ([] as DesignRecord[]),
      ]);
      if (cancelled.value) return;
      setMe(meInfo);

      let cloud: CloudDesignMeta[] = [];
      let conflictIds: string[] = [];
      let refreshedLocal = localRecords;
      if (meInfo.state === 'verified' && st && client) {
        try {
          // Join any Workbench save already syncing in this browser runtime;
          // this prevents duplicate baseRevision PUTs during SPA navigation.
          const outcome = await enqueueDesignSync(st, api);
          // 内部不变量（不面向用户，随即被下方 catch 转成 t.syncFailed 提示）。
          if (!outcome) throw new Error('sync did not start for a verified account');
          conflictIds = outcome.conflictCopies.map((conflict) => conflict.conflictId);
          cloud = outcome.cloud;
          // 同步可能改写本地存储（拉取覆盖/采纳服务端时间戳），重新读取后再构建列表
          refreshedLocal = st ? await st.getAll().catch(() => localRecords) : localRecords;
        } catch {
          setCloudFailed(true);
          cloud = await api.listDesigns().catch(() => []);
        }
      }
      if (cancelled.value) return;
      setConflicts(conflictIds);
      setDesigns(buildDisplay(refreshedLocal, cloud, meInfo, conflictIds));
    } catch {
      if (!cancelled.value) setError(t.loadFailed);
    } finally {
      if (!cancelled.value) setSyncing(false);
    }
  }, [api, storageOverride]);

  const loadCancelRef = useRef<{ value: boolean } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      if (loadCancelRef.current) loadCancelRef.current.value = true;
    };
  }, [load]);

  const ensureLocal = async (id: string): Promise<boolean> => {
    const st = storage;
    if (!st || !syncClient) return true; // 无本地存储时无法打开（页面会给出提示）
    const local = await st.getAll().catch(() => [] as DesignRecord[]);
    if (local.some((r) => r.id === id)) return true;
    try {
      await withDesignStorageLock(() => syncClient.pullDesign(id));
      return true;
    } catch {
      setError(t.loadFailed);
      return false;
    }
  };

  const handleOpen = async (design: DisplayDesign): Promise<void> => {
    const ok = await ensureLocal(design.id);
    if (!ok) return;
    router.push(`/app?id=${design.id}`);
  };

  const handleRename = async (): Promise<void> => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (name.length === 0 || name.length > 100) return;
    const ok = await ensureLocal(renaming.id);
    if (!ok || !syncClient) return;
    try {
      await withDesignStorageLock(() => syncClient.renameLocal(renaming.id, name, new Date().toISOString()));
      setRenaming(null);
      await load();
    } catch {
      setError(t.loadFailed);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleting) return;
    const st = storage;
    const client = syncClient ?? (st ? createSyncClient(st, api) : null);
    const nowIso = new Date().toISOString();
    try {
      if (st) {
        let cloudRevision = deleting.cloudPresent ? deleting.revision : 0;
        const currentIdentity = await api.me().catch((): MeInfo => ({ state: 'guest' }));
        if (cloudRevision <= 0 && currentIdentity.state === 'verified') {
          let currentCloud = await api.getDesign(deleting.id);
          if (!currentCloud) {
            // A save started by the previous document may still be crossing the
            // navigation boundary. Drain a full repository sync before deciding
            // that this is truly local-only, then probe once more.
            await enqueueDesignSync(st, api);
            currentCloud = await api.getDesign(deleting.id);
          }
          cloudRevision = currentCloud?.revision ?? 0;
        }
        if (cloudRevision > 0) {
          // A user-confirmed online delete is a conditional cloud mutation, not a
          // background best-effort write. Commit the CAS delete before removing
          // the local copy so a navigation or a late sync cannot resurrect it.
          await api.deleteDesign(deleting.id, cloudRevision);
          await withDesignStorageLock(() => st.delete(deleting.id));
        } else if (client) {
          // Local-only designs still use a durable tombstone so an earlier cloud
          // revision discovered on the next sync cannot silently reappear.
          await withDesignStorageLock(() => client.deleteLocal(deleting.id, nowIso, deleting.revision));
        }
      } else {
        await api.deleteDesign(deleting.id, deleting.revision);
      }
      setDeleting(null);
      await load();
    } catch {
      setError(t.loadFailed);
    }
  };

  const retrySync = async (): Promise<void> => {
    setSyncing(true);
    try {
      if (storage) await enqueueDesignSync(storage, api);
    } catch {
      setCloudFailed(true);
    }
    setSyncing(false);
    await load();
  };

  return (
    <main id="main" className="workspace-page flex w-full flex-col gap-4">
      <SiteHeader
        title={t.title}
        currentPath="/designs"
        subtitle={zhCN.workspace.designsSubtitle}
        primaryActions={
          <Link href="/app?new=1" className="btn-primary btn-sm">
            {t.newDesign}
          </Link>
        }
      />

      <section className="designs-hero">
        <div><span className="studio-eyebrow">{t.collectionKicker}</span><h2>{t.collectionTitle}</h2><p>{t.collectionHint}</p></div>
        <Link href="/app?new=1" className="btn-primary">{t.createFromHero}</Link>
      </section>

      {/* 设计数已达上限时先说清楚，而不是等用户新建后在保存阶段才失败（D-4）。 */}
      {activeDesignCount >= LIMITS.designsPerUser && (
        <Notice kind="warning">{t.limitError}</Notice>
      )}

      {(me === 'loading' || syncing) && designs.length === 0 && (
        <Notice kind="info">{t.loading}</Notice>
      )}

      {me !== 'loading' && me.state === 'guest' && (
        <Notice kind="info">
          {t.guestBanner}{' '}
          <Link href="/login" className="link-soft font-medium">
            {t.goLogin}
          </Link>
          {' · '}
          <Link href="/register" className="link-soft font-medium">
            {t.goRegister}
          </Link>
        </Notice>
      )}

      {conflicts.length > 0 && (
        <Notice kind="warning">{t.conflictBanner.replace('{n}', String(conflicts.length))}</Notice>
      )}

      {cloudFailed && (
        <Notice kind="info">
          <span>{t.syncFailed}</span>
          <button type="button" onClick={() => void retrySync()} disabled={syncing} className="btn-outline btn-xs">
            {syncing ? t.syncing : t.retry}
          </button>
        </Notice>
      )}

      {error && (
        <Notice kind="danger">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="btn-danger-outline btn-xs">
            {t.retry}
          </button>
        </Notice>
      )}

      {me !== 'loading' && !syncing && !error && designs.length === 0 && (
        <div className="designs-empty">
          <p className="font-medium text-ink">{t.emptyTitle}</p>
          <p className="text-sm text-ink-soft">{t.emptyHint}</p>
        </div>
      )}

      <ul className="designs-grid">
        {designs.map((design) => (
          <li key={design.id} className="design-card">
            <div className="design-card-canvas">
              {design.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={design.thumbnail}
                  /* D-9：所有缩略图原来共用同一句 alt「图纸缩略图」，读屏用户听到的
                     是一串完全相同的项；带上设计名与尺寸才能分辨。 */
                  alt={t.thumbnailAlt(design.name, design.width, design.height)}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-xs text-ink-soft">{t.size(design.width, design.height)}</span>
              )}
            </div>
            <p className="design-card-title" title={design.name}>
              {design.name}
            </p>
            <p className="text-xs text-ink-soft">{t.size(design.width, design.height)}</p>
            {design.colors.length > 0 && (
              <ColorBand colors={design.colors} max={12} label={t.colorBandAria(design.name, design.colors.length)} />
            )}
            <p className="text-xs text-ink-soft/80">{t.updatedAt(formatDateTime(design.updatedAt))}</p>
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="rounded-full bg-lilac-soft px-1.5 py-0.5 text-ink-soft">
                {design.localPresent ? t.localSaved : t.localMissing}
              </span>
              {design.status === 'synced' && <span className="rounded-full bg-success-soft px-1.5 py-0.5 text-success">{t.synced}</span>}
              {design.status === 'unsynced' && <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-warning">{t.unsynced}</span>}
              {design.status === 'localOnly' && <span className="rounded-full bg-lilac-soft px-1.5 py-0.5 text-ink-soft">{t.localOnly}</span>}
              {design.status === 'conflict' && <span className="rounded-full bg-danger-soft px-1.5 py-0.5 text-danger">{t.conflict}</span>}
            </div>
            <div className="design-card-actions">
              <button type="button" onClick={() => void handleOpen(design)} className="btn-outline btn-icon">
                {t.open}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRenaming(design);
                  setRenameValue(design.name);
                }}
                className="btn-outline btn-icon"
              >
                {t.rename}
              </button>
              <button type="button" onClick={() => setDeleting(design)} className="btn-danger-outline btn-xs">
                {t.delete}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {renaming && (
        <Modal label={t.renameTitle} onClose={() => setRenaming(null)} panelClassName="max-w-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleRename();
            }}
          >
            <h3 className="mb-2 text-sm font-medium text-ink">{t.renameTitle}</h3>
            <input
              aria-label={t.renameLabel}
              value={renameValue}
              maxLength={100}
              onChange={(e) => setRenameValue(e.target.value)}
              className="input-field"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setRenaming(null)} className="btn-outline btn-sm">
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={renameValue.trim().length === 0}
                className="btn-primary btn-sm"
              >
                {t.save}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal label={t.deleteTitle} onClose={() => setDeleting(null)} panelClassName="max-w-sm border-danger/40">
          <h3 className="mb-2 text-sm font-medium text-danger">{t.deleteTitle}</h3>
          <p className="mb-3 text-sm text-ink-soft">{fillDeleteHint(t.deleteHint, deleting.name)}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleting(null)} className="btn-outline btn-sm">
              {t.cancel}
            </button>
            <button type="button" onClick={() => void handleDelete()} className="btn-danger btn-sm">
              {t.delete}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
