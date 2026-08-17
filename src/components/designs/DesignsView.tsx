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
import AccountMenu from '@/components/account/AccountMenu';
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
    map.set(meta.id, { ...meta, thumbnail: null, status: 'synced', localPresent: false, cloudPresent: true });
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
          if (!outcome) throw new Error('已验证账号的同步未启动');
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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <SiteHeader
        title={t.title}
        currentPath="/designs"
        primaryActions={
          <Link href="/app?new=1" className="rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-primary-deep">
            {t.newDesign}
          </Link>
        }
        overflowActions={
          <AccountMenu api={api} me={me} onAuthChanged={() => void load()} />
        }
      />

      {(me === 'loading' || syncing) && designs.length === 0 && (
        <p role="status" className="rounded-xl bg-lilac-soft/60 p-3 text-sm text-ink-soft">
          {t.loading}
        </p>
      )}

      {me !== 'loading' && me.state === 'guest' && (
        <div className="rounded-xl border border-lilac/40 bg-lilac-soft p-3 text-sm text-ink">
          {t.guestBanner}{' '}
          <Link href="/login" className="font-medium text-primary-deep underline underline-offset-4">
            {t.goLogin}
          </Link>
        </div>
      )}

      {conflicts.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t.conflictBanner.replace('{n}', String(conflicts.length))}
        </div>
      )}

      {cloudFailed && (
        <div className="flex items-center gap-3 rounded-xl border border-lilac/30 bg-lilac-soft/60 p-3 text-sm text-ink-soft">
          <span>{t.syncFailed}</span>
          <button type="button" onClick={() => void retrySync()} disabled={syncing} className="rounded-full border border-lilac/50 px-2 py-0.5 text-xs transition-colors hover:bg-white disabled:bg-lilac-soft disabled:text-ink-soft/60">
            {syncing ? t.syncing : t.retry}
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="rounded-full border border-red-300 px-2 py-0.5 text-xs hover:bg-red-50">
            {t.retry}
          </button>
        </div>
      )}

      {me !== 'loading' && !syncing && !error && designs.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-lilac/50 p-10 text-center">
          <p className="font-medium text-ink">{t.emptyTitle}</p>
          <p className="text-sm text-ink-soft">{t.emptyHint}</p>
        </div>
      )}

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {designs.map((design) => (
          <li key={design.id} className="card-surface flex flex-col gap-2 p-3">
            <div className="flex h-32 items-center justify-center overflow-hidden rounded-xl bg-cream-deep/70">
              {design.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={design.thumbnail} alt={t.placeholder} className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-xs text-ink-soft/80">{t.size(design.width, design.height)}</span>
              )}
            </div>
            <p className="truncate text-sm font-medium text-ink" title={design.name}>
              {design.name}
            </p>
            <p className="text-xs text-ink-soft">{t.size(design.width, design.height)}</p>
            <p className="text-xs text-ink-soft/80">{t.updatedAt(formatDateTime(design.updatedAt))}</p>
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="rounded-full bg-lilac-soft px-1.5 py-0.5 text-ink-soft">
                {design.localPresent ? t.localSaved : t.localMissing}
              </span>
              {design.status === 'synced' && <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-green-700">{t.synced}</span>}
              {design.status === 'unsynced' && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700">{t.unsynced}</span>}
              {design.status === 'localOnly' && <span className="rounded-full bg-lilac-soft px-1.5 py-0.5 text-ink-soft">{t.localOnly}</span>}
              {design.status === 'conflict' && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-red-700">{t.conflict}</span>}
            </div>
            <div className="mt-auto flex flex-wrap gap-1 text-xs">
              <button type="button" onClick={() => void handleOpen(design)} className="rounded-full border border-lilac/50 px-2 py-1 transition-colors hover:bg-lilac-soft">
                {t.open}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRenaming(design);
                  setRenameValue(design.name);
                }}
                className="rounded-full border border-lilac/50 px-2 py-1 transition-colors hover:bg-lilac-soft"
              >
                {t.rename}
              </button>
              <button type="button" onClick={() => setDeleting(design)} className="rounded-full border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50">
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
              <button type="button" onClick={() => setRenaming(null)} className="rounded-full border border-lilac/50 px-3 py-1 text-sm text-ink-soft hover:bg-lilac-soft">
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={renameValue.trim().length === 0}
                className="rounded-full bg-primary px-3 py-1 text-sm font-semibold text-white transition-colors hover:bg-primary-deep disabled:opacity-50"
              >
                {t.save}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal label={t.deleteTitle} onClose={() => setDeleting(null)} panelClassName="max-w-sm border-red-200">
          <h3 className="mb-2 text-sm font-medium text-red-700">{t.deleteTitle}</h3>
          <p className="mb-3 text-sm text-ink-soft">{fillDeleteHint(t.deleteHint, deleting.name)}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleting(null)} className="rounded-full border border-lilac/50 px-3 py-1 text-sm text-ink-soft transition-colors hover:bg-lilac-soft">
              {t.cancel}
            </button>
            <button type="button" onClick={() => void handleDelete()} className="rounded bg-red-600 px-3 py-1 text-sm text-white">
              {t.delete}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
