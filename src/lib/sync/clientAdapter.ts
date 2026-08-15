/**
 * 浏览器侧同步适配（ticket 17）：把 src/lib/sync/engine.ts 的纯函数接到
 * 本地存储（src/lib/storage）与云端 designs API 之间。
 * 纯逻辑、可注入（storage/api 均由调用方传入），单测无需 DOM/网络。
 */
import { reconcile, sanitizeClientTimestamp, type SyncRecord } from './engine';
import { parseStoredProject } from '@/lib/storage';
import type { DesignRecord, StorageAdapter } from '@/lib/storage';
import type { ProjectFile } from '@/lib/types';

export interface CloudDesignMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  updatedAt: string;
  /** 云端墓碑（已删除）：updatedAt 即删除时间，供 LWW 传播删除 */
  deleted: boolean;
}

export interface CloudDesignFull {
  id: string;
  name: string;
  project: ProjectFile;
  updatedAt: string;
  deleted?: boolean;
}

/** 云端 designs API（fetch 实现见 ./api.ts；测试用假实现）。 */
export interface CloudApi {
  listDesigns(): Promise<CloudDesignMeta[]>;
  getDesign(id: string): Promise<CloudDesignFull | null>;
  putDesign(id: string, name: string, project: ProjectFile): Promise<{ updatedAt: string }>;
  deleteDesign(id: string): Promise<void>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;
  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export interface SyncOutcome {
  pushed: number;
  pulled: number;
  /** 云端较新、覆盖本地修改的设计 id（「已在其他设备更新」提示依据） */
  overwrittenByCloud: string[];
  errors: string[];
}

const TOMBSTONES_META_KEY = 'sync-tombstones';
const LAST_SERVER_TIME_KEY = 'sync-last-server-time';

interface TombstoneShape {
  id: string;
  updatedAt: string;
}

/** 本地设计记录 → 同步记录（损坏的项目 JSON 记入 errors 并跳过）。 */
function localToSync(records: DesignRecord[]): { records: SyncRecord[]; errors: string[] } {
  const out: SyncRecord[] = [];
  const errors: string[] = [];
  for (const record of records) {
    const project = parseStoredProject(record.projectJson);
    if (!project) {
      errors.push(`${record.id}: 本地数据无法解析，已跳过同步`);
      continue;
    }
    out.push({ id: record.id, updatedAt: record.updatedAt, deleted: false, project, name: record.name });
  }
  return { records: out, errors };
}

export function createSyncClient(storage: StorageAdapter, api: CloudApi) {
  async function loadTombstones(): Promise<SyncRecord[]> {
    const raw = await storage.getMeta(TOMBSTONES_META_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as TombstoneShape[];
      return parsed.map((t) => ({ id: t.id, updatedAt: t.updatedAt, deleted: true }));
    } catch {
      return [];
    }
  }

  async function saveTombstones(tombstones: SyncRecord[]): Promise<void> {
    const shapes: TombstoneShape[] = tombstones.map((t) => ({ id: t.id, updatedAt: t.updatedAt }));
    await storage.setMeta(TOMBSTONES_META_KEY, JSON.stringify(shapes));
  }

  return {
    /**
     * 一次完整同步（spec §F8，E35–E37）：
     * 本地（含墓碑）与云端列表 LWW 比对 → 推送/拉取 → 采纳服务端 updatedAt（幂等）。
     */
    async sync(): Promise<SyncOutcome> {
      const all = await storage.getAll();
      const { records: local, errors } = localToSync(all);
      const tombstones = await loadTombstones();
      const cloudMeta = await api.listDesigns();
      const cloud: SyncRecord[] = cloudMeta.map((m) => ({
        id: m.id,
        updatedAt: m.updatedAt,
        deleted: m.deleted,
        project: null,
        name: m.name,
      }));

      // 时钟偏差防护（安全审查 P2-8）：仅保护「上次同步之后」的本地编辑——
      // 若本地时间戳早于已知服务器时间（本机时钟落后），钳制为 maxServer+1ms；
      // 旧快照（≤ lastServer）与首次同步保持原样，交 LWW 判定（保守信任服务器）。
      // 本地墓碑同样参与钳制：否则落后时钟下删除会被云端较新内容覆盖而丢失。
      const lastServer = await storage.getMeta(LAST_SERVER_TIME_KEY);
      const maxServer = cloudMeta.reduce<string | null>(
        (max, m) => (max === null || m.updatedAt > max ? m.updatedAt : max),
        null,
      );
      let tombstonesChanged = false;
      for (const record of [...local, ...tombstones]) {
        // 本地墓碑（删除意图）不受 lastServer 门控：删除必须能赢过旧快照。
        // 若客户端时钟落后，sanitize 会钳制到 maxServer+1ms；否则按原时间参与 LWW。
        // （普通本地记录仍保留门控：≤ lastServer 的旧快照保守信任服务器，避免误判脏数据。）
        if (!record.deleted && (!lastServer || record.updatedAt <= lastServer)) continue;
        const sanitized = sanitizeClientTimestamp(record.updatedAt, maxServer);
        if (sanitized === record.updatedAt) continue;
        record.updatedAt = sanitized;
        if (record.deleted) {
          tombstonesChanged = true;
          continue;
        }
        if (record.project) record.project.updatedAt = sanitized;
        const existing = all.find((r) => r.id === record.id);
        if (existing) {
          existing.updatedAt = sanitized;
          if (record.project) existing.projectJson = JSON.stringify(record.project);
          await storage.put(existing);
        }
      }
      if (tombstonesChanged) await saveTombstones(tombstones);

      const result = reconcile([...local, ...tombstones], cloud);
      const outcome: SyncOutcome = { pushed: 0, pulled: 0, overwrittenByCloud: result.overwrittenByCloud, errors: [...errors] };

      // 推送
      const pushedTombstoneIds: string[] = [];
      let maxAdopted: string | null = null; // 本轮推送中服务端回显的最大时间戳
      for (const record of result.toPush) {
        try {
          if (record.deleted) {
            await api.deleteDesign(record.id);
            pushedTombstoneIds.push(record.id);
          } else if (record.project) {
            const name = record.name ?? record.project.name;
            const response = await api.putDesign(record.id, name, record.project);
            if (!maxAdopted || response.updatedAt > maxAdopted) maxAdopted = response.updatedAt;
            // 采纳服务端 updatedAt：本地内容与云端时间戳对齐，下次比对准幂等
            const existing = all.find((r) => r.id === record.id);
            if (existing) {
              const project: ProjectFile = { ...record.project, updatedAt: response.updatedAt };
              existing.projectJson = JSON.stringify(project);
              existing.updatedAt = response.updatedAt;
              existing.name = name;
              await storage.put(existing);
            }
          } else {
            outcome.errors.push(`${record.id}: 缺少项目数据，已跳过推送`);
            continue;
          }
          outcome.pushed++;
        } catch (error) {
          outcome.errors.push(`${record.id}: ${error instanceof Error ? error.message : '推送失败'}`);
        }
      }

      // 清理已推送的墓碑
      if (pushedTombstoneIds.length > 0) {
        await saveTombstones(tombstones.filter((t) => !pushedTombstoneIds.includes(t.id)));
      }

      // 拉取
      for (const record of result.toPull) {
        try {
          if (record.deleted) {
            await storage.delete(record.id);
          } else {
            const full = await api.getDesign(record.id);
            if (full) {
              await storage.put({
                id: full.id,
                name: full.name,
                projectJson: JSON.stringify(full.project),
                thumbnail: null,
                updatedAt: full.updatedAt,
              });
            }
          }
          outcome.pulled++;
        } catch (error) {
          outcome.errors.push(`${record.id}: ${error instanceof Error ? error.message : '拉取失败'}`);
        }
      }

      // 记录本次同步后的服务器时间基准（时钟偏差防护的门控依据）。
      // 必须包含本轮推送回显的时间戳：否则下次同步会把「已对齐的相等时间戳」再钳制 +1ms，
      // 造成每轮都误判为脏数据而无限推送。
      let newBaseline = maxServer ?? lastServer;
      if (maxAdopted && (!newBaseline || maxAdopted > newBaseline)) newBaseline = maxAdopted;
      if (newBaseline) {
        await storage.setMeta(LAST_SERVER_TIME_KEY, newBaseline);
      }

      return outcome;
    },

    /** 拉取单个云端设计到本地（云端独有的设计在打开/重命名前调用）。 */
    async pullDesign(id: string): Promise<void> {
      const full = await api.getDesign(id);
      if (!full) throw new ApiError(404, 'NOT_FOUND', '设计不存在');
      await storage.put({
        id: full.id,
        name: full.name,
        projectJson: JSON.stringify(full.project),
        thumbnail: null,
        updatedAt: full.updatedAt,
      });
    },

    /** 本地删除（ticket 语义）：写本地墓碑，由下一次 sync 推送墓碑并调云端 DELETE。 */
    async deleteLocal(id: string, nowIso: string): Promise<void> {
      const tombstones = await loadTombstones();
      await saveTombstones([...tombstones.filter((t) => t.id !== id), { id, updatedAt: nowIso, deleted: true }]);
      await storage.delete(id);
    },

    /** 本地重命名：更新项目名与时间戳（下次 sync 推送）。 */
    async renameLocal(id: string, name: string, nowIso: string): Promise<void> {
      const all = await storage.getAll();
      const record = all.find((r) => r.id === id);
      if (!record) throw new ApiError(404, 'NOT_FOUND', '设计不存在');
      const project = parseStoredProject(record.projectJson);
      if (!project) throw new ApiError(400, 'VALIDATION', '本地数据无法解析');
      const updated: ProjectFile = { ...project, name, updatedAt: nowIso };
      await storage.put({
        ...record,
        name,
        projectJson: JSON.stringify(updated),
        updatedAt: nowIso,
      });
    },
  };
}

export type SyncClient = ReturnType<typeof createSyncClient>;
