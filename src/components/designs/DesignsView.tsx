'use client';

/** 我的设计列表页（ticket 17）：本地 + 云端设计网格、同步角标、重命名/删除、账号菜单。 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';
import { createDoupuApi, type DoupuApi, type MeInfo } from '@/lib/sync/api';
import { createSyncClient, type CloudDesignMeta, type SyncClient } from '@/lib/sync/clientAdapter';
import { openIndexedDb, parseStoredProject, type DesignRecord, type StorageAdapter } from '@/lib/storage';
import AccountMenu from '@/components/account/AccountMenu';
import { fillDeleteHint, formatDateTime } from './format';

export interface DisplayDesign {
  id: string;
  name: string;
  width: number;
  height: number;
  updatedAt: string;
  thumbnail: string | null;
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
    map.set(meta.id, { ...meta, thumbnail: null, status: 'synced' });
  }
  for (const record of local) {
    const project = parseStoredProject(record.projectJson);
    const cloudEntry = map.get(record.id);
    let status: DisplayDesign['status'];
    if (conflicts.includes(record.id)) status = 'conflict';
    else if (!cloudEntry) status = meInfo.state === 'guest' ? 'localOnly' : 'unsynced';
    else if (cloudEntry.updatedAt === record.updatedAt) status = 'synced';
    else if (record.updatedAt > cloudEntry.updatedAt) status = 'unsynced';
    else status = 'synced';
    map.set(record.id, {
      id: record.id,
      name: record.name,
      width: project?.pattern.width ?? 0,
      height: project?.pattern.height ?? 0,
      updatedAt: record.updatedAt,
      thumbnail: record.thumbnail,
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
    setError(null);
    setCloudFailed(false);
    setSyncing(true);
    try {
      const st = storageOverride !== undefined ? storageOverride : await openIndexedDb().catch(() => null);
      setStorage(st);
      const client = st ? createSyncClient(st, api) : null;
      setSyncClient(client);

      const [meInfo, localRecords] = await Promise.all([
        api.me().catch((): MeInfo => ({ state: 'guest' })),
        st ? st.getAll().catch(() => [] as DesignRecord[]) : ([] as DesignRecord[]),
      ]);
      setMe(meInfo);

      let cloud: CloudDesignMeta[] = [];
      let conflictIds: string[] = [];
      let refreshedLocal = localRecords;
      if (meInfo.state === 'verified' && client) {
        try {
          cloud = await api.listDesigns();
          const outcome = await client.sync();
          conflictIds = outcome.overwrittenByCloud;
          cloud = await api.listDesigns();
          // 同步可能改写本地存储（拉取覆盖/采纳服务端时间戳），重新读取后再构建列表
          refreshedLocal = st ? await st.getAll().catch(() => localRecords) : localRecords;
        } catch {
          setCloudFailed(true);
          try {
            cloud = await api.listDesigns().catch(() => []);
          } catch {
            cloud = [];
          }
        }
      }
      setConflicts(conflictIds);
      setDesigns(buildDisplay(refreshedLocal, cloud, meInfo, conflictIds));
    } catch {
      setError(t.loadFailed);
    } finally {
      setSyncing(false);
    }
  }, [api, storageOverride]);

  useEffect(() => {
    void load();
  }, [load]);

  const ensureLocal = async (id: string): Promise<boolean> => {
    const st = storage;
    if (!st || !syncClient) return true; // 无本地存储时无法打开（页面会给出提示）
    const local = await st.getAll().catch(() => [] as DesignRecord[]);
    if (local.some((r) => r.id === id)) return true;
    try {
      await syncClient.pullDesign(id);
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
      await syncClient.renameLocal(renaming.id, name, new Date().toISOString());
      setRenaming(null);
      await load();
    } catch {
      setError(t.loadFailed);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleting) return;
    const st = storage;
    const client = syncClient;
    const nowIso = new Date().toISOString();
    try {
      if (st) {
        const local = await st.getAll().catch(() => [] as DesignRecord[]);
        if (local.some((r) => r.id === deleting.id)) {
          if (client) await client.deleteLocal(deleting.id, nowIso);
        } else {
          await api.deleteDesign(deleting.id);
        }
      } else {
        await api.deleteDesign(deleting.id);
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
      if (syncClient) await syncClient.sync();
    } catch {
      setCloudFailed(true);
    }
    setSyncing(false);
    await load();
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
        <h1 className="text-lg font-semibold">{t.title}</h1>
        <div className="flex items-center gap-4">
          <Link href="/app" className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">
            {t.newDesign}
          </Link>
          <AccountMenu api={api} me={me} onAuthChanged={() => void load()} />
        </div>
      </header>

      {me !== 'loading' && me.state === 'guest' && (
        <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          {t.guestBanner}{' '}
          <Link href="/login" className="font-medium underline underline-offset-4">
            {t.goLogin}
          </Link>
        </div>
      )}

      {conflicts.length > 0 && (
        <div role="alert" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t.conflictBanner.replace('{n}', String(conflicts.length))}
        </div>
      )}

      {cloudFailed && (
        <div className="flex items-center gap-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          <span>{t.syncFailed}</span>
          <button type="button" onClick={() => void retrySync()} disabled={syncing} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-50">
            {syncing ? t.syncing : t.retry}
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="rounded border border-red-300 px-2 py-0.5 text-xs">
            {t.retry}
          </button>
        </div>
      )}

      {!error && designs.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded border-2 border-dashed border-gray-200 p-10 text-center">
          <p className="font-medium text-gray-700">{t.emptyTitle}</p>
          <p className="text-sm text-gray-500">{t.emptyHint}</p>
        </div>
      )}

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {designs.map((design) => (
          <li key={design.id} className="flex flex-col gap-2 rounded border border-gray-200 p-3">
            <div className="flex h-32 items-center justify-center overflow-hidden rounded bg-gray-100">
              {design.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={design.thumbnail} alt={t.placeholder} className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-xs text-gray-400">{t.size(design.width, design.height)}</span>
              )}
            </div>
            <p className="truncate text-sm font-medium" title={design.name}>
              {design.name}
            </p>
            <p className="text-xs text-gray-500">{t.size(design.width, design.height)}</p>
            <p className="text-xs text-gray-400">{t.updatedAt(formatDateTime(design.updatedAt))}</p>
            <div className="flex flex-wrap items-center gap-1 text-xs">
              {design.status === 'synced' && <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-700">{t.synced}</span>}
              {design.status === 'unsynced' && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">{t.unsynced}</span>}
              {design.status === 'localOnly' && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{t.localOnly}</span>}
              {design.status === 'conflict' && <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">{t.conflict}</span>}
            </div>
            <div className="mt-auto flex gap-2 text-xs">
              <button type="button" onClick={() => void handleOpen(design)} className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50">
                {t.open}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRenaming(design);
                  setRenameValue(design.name);
                }}
                className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50"
              >
                {t.rename}
              </button>
              <button type="button" onClick={() => setDeleting(design)} className="rounded border border-red-300 px-2 py-0.5 text-red-600 hover:bg-red-50">
                {t.delete}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {renaming && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30">
          <div role="dialog" aria-modal="true" aria-label={t.renameTitle} className="w-80 rounded border border-gray-300 bg-white p-4 shadow-lg">
            <h3 className="mb-2 text-sm font-medium">{t.renameTitle}</h3>
            <input
              aria-label={t.renameLabel}
              value={renameValue}
              maxLength={100}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setRenaming(null)} className="rounded border border-gray-300 px-3 py-1 text-sm">
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={() => void handleRename()}
                disabled={renameValue.trim().length === 0}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                {t.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30">
          <div role="dialog" aria-modal="true" aria-label={t.deleteTitle} className="w-80 rounded border border-red-200 bg-white p-4 shadow-lg">
            <h3 className="mb-2 text-sm font-medium text-red-700">{t.deleteTitle}</h3>
            <p className="mb-3 text-sm text-gray-600">{fillDeleteHint(t.deleteHint, deleting.name)}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleting(null)} className="rounded border border-gray-300 px-3 py-1 text-sm">
                {t.cancel}
              </button>
              <button type="button" onClick={() => void handleDelete()} className="rounded bg-red-600 px-3 py-1 text-sm text-white">
                {t.delete}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
