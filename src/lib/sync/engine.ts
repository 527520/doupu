/**
 * 客户端↔云端同步引擎（spec §F8，边界 E35–E38）。
 * 纯函数：不依赖 DOM/网络；IndexedDB/HTTP 适配在 ticket 17 接入。
 * LWW 按 updatedAt（ISO 8601 UTC 字符串可直接字典序比较）；删除用墓碑（deleted: true）。
 */
import type { ProjectFile } from '@/lib/types';

export interface SyncRecord {
  id: string;
  /** ISO 8601 UTC；同格式下字符串比较即时间比较 */
  updatedAt: string;
  deleted: boolean;
  project?: ProjectFile | null;
  name?: string;
}

export interface ReconcileResult {
  /** 需要推送到云端的本地条目（含墓碑） */
  toPush: SyncRecord[];
  /** 需要从云端拉取的条目（含墓碑） */
  toPull: SyncRecord[];
  /** 云端较新、覆盖了本地修改的条目 id（「已在其他设备更新」提示依据） */
  overwrittenByCloud: string[];
}

export function compareUpdatedAt(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 客户端时钟偏差防护（安全审查 P2-8）：
 * 离线编辑产生的本地时间戳若 ≤ 已知服务器时间（本机时钟落后），
 * 会被 LWW 误判为旧数据；此处钳制为 maxServer + 1ms 并返回。
 * 客户端时钟领先时原样保留（服务器仍采纳其时间，跨设备下一轮比对以服务端回显对齐）。
 */
export function sanitizeClientTimestamp(clientIso: string, maxServerIso: string | null): string {
  if (!maxServerIso) return clientIso;
  const client = Date.parse(clientIso);
  const server = Date.parse(maxServerIso);
  if (!Number.isFinite(client) || !Number.isFinite(server)) return clientIso;
  return client <= server ? new Date(server + 1).toISOString() : clientIso;
}

/**
 * 双向比对（LWW）：
 * - 本地独有 → push（含本地墓碑）；
 * - 云端独有 → pull（云端墓碑且本地从未见过该 id 时忽略，避免垃圾墓碑）；
 * - 双方都有：updatedAt 较新者胜；本地较新 → push（本地编辑可复活云端已删条目，E37）；
 *   云端较新 → pull 并记入 overwrittenByCloud；相等 → 幂等无操作（重复重放安全，E35）。
 * 输出按 id 排序，完全确定。
 */
export function reconcile(local: SyncRecord[], cloud: SyncRecord[]): ReconcileResult {
  const localById = new Map(local.map((r) => [r.id, r]));
  const cloudById = new Map(cloud.map((r) => [r.id, r]));
  const toPush: SyncRecord[] = [];
  const toPull: SyncRecord[] = [];
  const overwrittenByCloud: string[] = [];

  const ids = new Set([...localById.keys(), ...cloudById.keys()]);
  for (const id of [...ids].sort()) {
    const l = localById.get(id);
    const c = cloudById.get(id);
    if (!l) {
      if (c && !c.deleted) toPull.push(c);
      continue;
    }
    if (!c) {
      toPush.push(l);
      continue;
    }
    const cmp = compareUpdatedAt(l.updatedAt, c.updatedAt);
    if (cmp > 0) {
      toPush.push(l);
    } else if (cmp < 0) {
      toPull.push(c);
      overwrittenByCloud.push(id);
    }
    // cmp === 0：无操作（幂等）
  }
  return { toPush, toPull, overwrittenByCloud };
}

/** 应用云端拉取结果：墓碑删除本地条目，其余按 id upsert。返回新数组（按 id 排序，确定性）。 */
export function applyRemote(local: SyncRecord[], pulled: SyncRecord[]): SyncRecord[] {
  const result = new Map(local.map((r) => [r.id, r]));
  for (const record of pulled) {
    if (record.deleted) result.delete(record.id);
    else result.set(record.id, record);
  }
  return [...result.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 本地 upsert（编辑/新建）：更新内容与 updatedAt。 */
export function upsertLocal(local: SyncRecord[], record: SyncRecord): SyncRecord[] {
  const result = new Map(local.map((r) => [r.id, r]));
  result.set(record.id, record);
  return [...result.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 本地删除：置墓碑并更新时间戳（E37 本地离线删除的推送依据）。 */
export function markLocalDeleted(local: SyncRecord[], id: string, deletedAt: string): SyncRecord[] {
  return local.map((r) => (r.id === id ? { id: r.id, updatedAt: deletedAt, deleted: true } : r));
}
