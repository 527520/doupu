import type { StorageAdapter } from '@/lib/storage';
import { createSyncClient, type CloudApi, type SyncOutcome } from './clientAdapter';
import type { MeInfo } from './api';

const PENDING_KEY = 'sync-background-pending-v2';
// One browser runtime owns one IndexedDB-backed design repository. Components
// may wrap that repository in different adapter objects as they mount, so the
// single-flight lock must live at module scope rather than keying by wrapper
// identity (which allowed Workbench and DesignsView to race the same CAS PUT).
let running: Promise<unknown> | null = null;
let rerunRequested = false;
let latestWork: { storage: StorageAdapter; run: () => Promise<unknown> } | null = null;
let inProcessLockTail: Promise<void> = Promise.resolve();
// A route without an active document (for example DesignsView) can discover a
// conflict immediately before Workbench joins the same single-flight. Keep
// document-relevant outcomes until an active-session callback consumes them;
// otherwise the coalesced tail's empty result hides the original conflict.
const pendingSessionOutcomes: SyncOutcome[] = [];

type BrowserLockManager = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

/** Serialize every IndexedDB design mutation with cloud reconciliation. */
export async function withDesignStorageLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { locks?: BrowserLockManager }).locks;
  if (locks?.request) return locks.request('doupu-design-sync-v2', run);
  // Web Locks is available in supported browsers. This fallback also keeps
  // jsdom/older engines safe within one runtime instead of silently racing.
  const previous = inProcessLockTail;
  let release!: () => void;
  inProcessLockTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await run();
  } finally {
    release();
  }
}

export async function hasPendingSync(storage: StorageAdapter): Promise<boolean> {
  return (await storage.getMeta(PENDING_KEY)) === '1';
}

/** Acknowledges that a full sync pass completed successfully, without exposing queue metadata. */
export async function acknowledgePendingSync(storage: StorageAdapter): Promise<void> {
  await storage.setMeta(PENDING_KEY, '0');
}

/** Converts per-item sync errors into a failed queue attempt so durable retry intent is retained. */
export function requireCompleteDesignSync(outcome: Pick<SyncOutcome, 'errors'>): void {
  if (outcome.errors.length > 0) throw new Error('同步未完整完成，请稍后重试');
}

/**
 * Coalesces local-save bursts and persists retry intent. A failed/offline run intentionally leaves
 * the marker set; the next app bootstrap or explicit retry can enqueue the same idempotent CAS sync.
 */
export function enqueueBackgroundSync<T>(storage: StorageAdapter, run: () => Promise<T>): Promise<T> {
  latestWork = { storage, run };
  if (running) {
    // The active pass may already have taken its IndexedDB snapshot. Remember
    // one tail pass; further saves coalesce by replacing latestWork.
    rerunRequested = true;
    return running as Promise<T>;
  }
  const work = (async (): Promise<unknown> => {
    try {
      let result: unknown;
      for (;;) {
        const current = latestWork;
        if (!current) throw new Error('background sync work is unavailable');
        rerunRequested = false;
        result = await withDesignStorageLock(async () => {
          await current.storage.setMeta(PENDING_KEY, '1');
          return current.run();
        });
        if (rerunRequested) continue;
        await acknowledgePendingSync(current.storage);
        // A save can arrive while the durable marker write is in flight.
        if (rerunRequested) continue;
        running = null;
        latestWork = null;
        return result;
      }
    } catch (error) {
      running = null;
      latestWork = null;
      rerunRequested = false;
      throw error;
    }
  })();
  running = work;
  return work as Promise<T>;
}

export interface AuthenticatedCloudApi extends CloudApi {
  me(): Promise<MeInfo>;
}

function needsSessionConsumption(outcome: SyncOutcome): boolean {
  return outcome.conflictCopies.length > 0 || outcome.overwrittenByCloud.length > 0;
}

async function replayPendingSessionOutcomes(
  onOutcome: (outcome: SyncOutcome) => void | Promise<void>,
): Promise<void> {
  while (pendingSessionOutcomes.length > 0) {
    await onOutcome(pendingSessionOutcomes[0]);
    pendingSessionOutcomes.shift();
  }
}

/** Workbench seam: local persistence remains authoritative and cloud work is queued after it. */
export function enqueueDesignSync(
  storage: StorageAdapter,
  api: AuthenticatedCloudApi,
  onOutcome?: (outcome: SyncOutcome) => void | Promise<void>,
): Promise<SyncOutcome | null> {
  return enqueueBackgroundSync(storage, async () => {
    if (onOutcome) await replayPendingSessionOutcomes(onOutcome);
    const me = await api.me();
    if (me.state !== 'verified') return null;
    const outcome = await createSyncClient(storage, api).sync();
    if (onOutcome) {
      try {
        await onOutcome(outcome);
      } catch (error) {
        if (needsSessionConsumption(outcome)) pendingSessionOutcomes.push(outcome);
        throw error;
      }
    } else if (needsSessionConsumption(outcome)) {
      pendingSessionOutcomes.push(outcome);
    }
    // A pass can create a conflict copy before another record fails. Preserve
    // or deliver that irreversible session outcome before retaining durable
    // retry intent for the remaining errors.
    requireCompleteDesignSync(outcome);
    return outcome;
  });
}
