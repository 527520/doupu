import { conflictName } from '@/lib/project/parse';
import {
  CLEAR_GENERATION_SOURCE,
  PRESERVE_GENERATION_SOURCE,
  parseStoredProject,
  replaceGenerationSource,
  type DesignRecord,
  type GenerationSourceWrite,
  type StorageAdapter,
} from '@/lib/storage';
import type { ProjectFile } from '@/lib/types';

export interface CloudDesignMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  updatedAt: string;
  deleted: boolean;
  revision: number;
}

export interface CloudDesignFull {
  id: string;
  name: string;
  project: ProjectFile;
  updatedAt: string;
  revision: number;
  deleted?: boolean;
}

export interface CloudDesignPage {
  items: CloudDesignMeta[];
  nextCursor: string | null;
}

export interface CloudApi {
  listDesignsPage(cursor?: string): Promise<CloudDesignPage>;
  getDesign(id: string): Promise<CloudDesignFull | null>;
  putDesign(id: string, name: string, project: ProjectFile, baseRevision: number): Promise<{ updatedAt: string; revision: number }>;
  deleteDesign(id: string, baseRevision: number): Promise<{ updatedAt: string; revision: number }>;
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
  overwrittenByCloud: string[];
  conflictCopies: Array<{ originalId: string; conflictId: string }>;
  errors: string[];
  cloud: CloudDesignMeta[];
}

interface TombstoneShape { id: string; baseRevision: number }
interface SyncClientOptions { newId?: () => string; now?: () => Date }
const TOMBSTONES_META_KEY = 'sync-tombstones-v2';

function normalizeRecord(record: DesignRecord): DesignRecord {
  return { ...record, revision: record.revision ?? 0, syncState: record.syncState ?? ((record.revision ?? 0) > 0 ? 'synced' : 'dirty') };
}

function projectsMatch(local: ProjectFile, remote: ProjectFile): boolean {
  return JSON.stringify(canonicalProject(local)) === JSON.stringify(canonicalProject(remote));
}

/**
 * A local generation source is tied to the design content, not its title or
 * timestamps. Renaming the same design on another device must not discard the
 * only local copy of its pixels.
 */
function generationSourceMatches(local: ProjectFile, remote: ProjectFile): boolean {
  const withoutMetadata = (project: ProjectFile): unknown => {
    const canonical = canonicalProject(project) as Record<string, unknown>;
    const { name: _name, createdAt: _createdAt, ...content } = canonical;
    return content;
  };
  return JSON.stringify(withoutMetadata(local)) === JSON.stringify(withoutMetadata(remote));
}

function canonicalProject(project: ProjectFile): unknown {
  return {
    format: project.format,
    version: project.version,
    engineVersion: project.engineVersion,
    boardProfile: project.boardProfile,
    name: project.name,
    createdAt: project.createdAt,
    paletteSelection: {
      kitTier: project.paletteSelection.kitTier,
      palette: project.paletteSelection.palette.kind === 'builtin'
        ? { kind: 'builtin', brand: project.paletteSelection.palette.brand }
        : {
            kind: 'custom',
            colors: project.paletteSelection.palette.colors.map((color) => ({
              code: color.code,
              hex: color.hex.toUpperCase(),
            })),
          },
    },
    params: {
      targetWidth: project.params.targetWidth,
      targetColorCount: project.params.targetColorCount,
      dithering: project.params.dithering,
      mode: project.params.mode,
      brightness: project.params.brightness,
      contrast: project.params.contrast,
      backgroundRemoval: project.params.backgroundRemoval,
      bgTolerance: project.params.bgTolerance,
      backgroundPrototype: project.params.backgroundPrototype?.toUpperCase() ?? null,
    },
    pattern: {
      width: project.pattern.width,
      height: project.pattern.height,
      cells: project.pattern.cells.map((cell) => ({
        hex: cell.hex?.toUpperCase() ?? null,
        code: cell.code,
        transparent: cell.transparent,
        external: Boolean(cell.external),
      })),
    },
  };
}

function remoteMeta(remote: CloudDesignFull): CloudDesignMeta {
  return {
    id: remote.id,
    name: remote.name,
    width: remote.project.pattern.width,
    height: remote.project.pattern.height,
    updatedAt: remote.updatedAt,
    deleted: remote.deleted ?? false,
    revision: remote.revision,
  };
}

function upsertOutcomeCloud(outcome: SyncOutcome, remote: CloudDesignFull): void {
  const meta = remoteMeta(remote);
  const index = outcome.cloud.findIndex((item) => item.id === remote.id);
  if (index >= 0) outcome.cloud[index] = meta;
  else outcome.cloud.push(meta);
}

function defaultNewId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `conflict-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function listAllDesigns(api: CloudApi): Promise<CloudDesignMeta[]> {
  const rows: CloudDesignMeta[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await api.listDesignsPage(cursor);
    for (const item of page.items) {
      if (ids.has(item.id)) throw new ApiError(502, 'INVALID_PAGE', `分页结果包含重复设计 ${item.id}`);
      ids.add(item.id);
      rows.push(item);
    }
    if (!page.nextCursor) return rows;
    if (cursors.has(page.nextCursor)) throw new ApiError(502, 'INVALID_PAGE', '分页游标形成循环');
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

export function createSyncClient(storage: StorageAdapter, api: CloudApi, options: SyncClientOptions = {}) {
  const newId = options.newId ?? defaultNewId;
  const now = options.now ?? (() => new Date());

  async function loadTombstones(): Promise<TombstoneShape[]> {
    const raw = await storage.getMeta(TOMBSTONES_META_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as TombstoneShape[];
      return parsed.filter((item) => typeof item.id === 'string' && Number.isInteger(item.baseRevision) && item.baseRevision > 0);
    } catch { return []; }
  }
  async function saveTombstones(tombstones: TombstoneShape[]): Promise<void> {
    await storage.setMeta(TOMBSTONES_META_KEY, JSON.stringify(tombstones));
  }
  async function storeRemote(
    remote: CloudDesignFull,
    sourceWrite: GenerationSourceWrite = CLEAR_GENERATION_SOURCE,
    thumbnail: string | null = null,
  ): Promise<void> {
    await storage.put(
      { id: remote.id, name: remote.name, projectJson: JSON.stringify(remote.project), thumbnail, updatedAt: remote.updatedAt, revision: remote.revision, syncState: 'synced' },
      sourceWrite,
    );
  }
  const matchesSnapshot = (latest: DesignRecord, snapshot: DesignRecord): boolean =>
    latest.projectJson === snapshot.projectJson
    && latest.name === snapshot.name
    && latest.updatedAt === snapshot.updatedAt;
  async function recordDeleteIntent(id: string, baseRevision: number): Promise<void> {
    const tombstones = await loadTombstones();
    await saveTombstones([
      ...tombstones.filter((item) => item.id !== id),
      { id, baseRevision },
    ]);
  }
  async function createConflictCopy(
    source: DesignRecord,
    project: ProjectFile,
    outcome: SyncOutcome,
  ): Promise<string> {
    const conflictId = newId();
    const generationSource = await storage.getGenerationSource(source.id);
    const names = (await storage.getAll()).map((item) => item.name);
    const name = conflictName(`${source.name} (冲突副本)`, names);
    const updatedAt = now().toISOString();
    const conflictProject: ProjectFile = { ...project, name, updatedAt };
    await storage.put(
      {
        ...source,
        id: conflictId,
        name,
        projectJson: JSON.stringify(conflictProject),
        updatedAt,
        revision: 0,
        syncState: 'conflict',
      },
      generationSource
        ? replaceGenerationSource(generationSource)
        : CLEAR_GENERATION_SOURCE,
    );
    outcome.conflictCopies.push({ originalId: source.id, conflictId });
    return conflictId;
  }
  async function storePutResult(
    local: DesignRecord,
    project: ProjectFile,
    response: { updatedAt: string; revision: number },
  ): Promise<void> {
    const latest = (await storage.getAll()).find((record) => record.id === local.id);
    if (!latest) {
      // The user deleted the row while PUT was in flight. Convert that intent
      // into a tombstone based on the newly-created cloud revision.
      await recordDeleteIntent(local.id, response.revision);
      return;
    }
    if (matchesSnapshot(latest, local)) {
      await storage.put({
        ...latest,
        projectJson: JSON.stringify({ ...project, updatedAt: response.updatedAt }),
        updatedAt: response.updatedAt,
        revision: response.revision,
        // A conflict copy is a real independent cloud design, but it keeps its
        // visible conflict marker until the user explicitly edits/resolves it.
        syncState: local.syncState === 'conflict' ? 'conflict' : 'synced',
      });
      return;
    }
    // A newer local edit arrived after this pass took its snapshot. Preserve it
    // and advance only its base revision so the mandatory tail pass can CAS it.
    await storage.put({ ...latest, revision: response.revision, syncState: 'dirty' });
  }
  async function resolvePutConflict(local: DesignRecord, project: ProjectFile, outcome: SyncOutcome): Promise<void> {
    const remote = await api.getDesign(local.id);
    const latest = (await storage.getAll()).find((record) => record.id === local.id);
    if (remote && remote.name === local.name && projectsMatch(project, remote.project)) {
      upsertOutcomeCloud(outcome, remote);
      if (!latest) await recordDeleteIntent(local.id, remote.revision);
      else if (matchesSnapshot(latest, local)) await storeRemote(remote, PRESERVE_GENERATION_SOURCE, latest.thumbnail);
      else await storage.put({ ...latest, revision: remote.revision, syncState: 'dirty' });
      return;
    }
    if (!latest) {
      if (remote) {
        await recordDeleteIntent(local.id, remote.revision);
        upsertOutcomeCloud(outcome, remote);
      }
      return;
    }
    const latestProject = parseStoredProject(latest.projectJson);
    if (!latestProject) {
      outcome.errors.push(`${local.id}: 冲突时本地数据无法解析`);
      return;
    }
    await createConflictCopy(latest, latestProject, outcome);
    if (remote) {
      await storeRemote(remote);
      upsertOutcomeCloud(outcome, remote);
    } else await storage.delete(local.id);
    outcome.overwrittenByCloud.push(local.id);
  }
  async function storePulledRemote(
    snapshot: DesignRecord,
    remote: CloudDesignFull,
    outcome: SyncOutcome,
  ): Promise<void> {
    const latest = (await storage.getAll()).find((record) => record.id === snapshot.id);
    if (!latest) {
      await recordDeleteIntent(snapshot.id, remote.revision);
      return;
    }
    if (matchesSnapshot(latest, snapshot)) {
      const snapshotProject = parseStoredProject(snapshot.projectJson);
      const sameGenerationContent = snapshotProject !== null
        && generationSourceMatches(snapshotProject, remote.project);
      await storeRemote(
        remote,
        sameGenerationContent
          ? PRESERVE_GENERATION_SOURCE
          : CLEAR_GENERATION_SOURCE,
        sameGenerationContent
          ? latest.thumbnail
          : null,
      );
      return;
    }
    const latestProject = parseStoredProject(latest.projectJson);
    if (!latestProject) {
      outcome.errors.push(`${snapshot.id}: 拉取时本地数据无法解析`);
      return;
    }
    await createConflictCopy(latest, latestProject, outcome);
    await storeRemote(remote);
  }
  async function applyRemoteDeletion(snapshot: DesignRecord, outcome: SyncOutcome): Promise<void> {
    const latest = (await storage.getAll()).find((record) => record.id === snapshot.id);
    if (!latest) return;
    if (matchesSnapshot(latest, snapshot)) {
      await storage.delete(snapshot.id);
      return;
    }
    // A user edit landed while the cloud listing was in flight. The cloud
    // tombstone remains authoritative for the original id, but the newer local
    // bytes must survive under a conflict id.
    const latestProject = parseStoredProject(latest.projectJson);
    if (!latestProject) {
      outcome.errors.push(`${snapshot.id}: 删除冲突时本地数据无法解析`);
      return;
    }
    await createConflictCopy(latest, latestProject, outcome);
    await storage.delete(snapshot.id);
  }

  return {
    async sync(): Promise<SyncOutcome> {
      const all = (await storage.getAll()).map(normalizeRecord);
      const tombstones = await loadTombstones();
      const cloud = await listAllDesigns(api);
      const cloudById = new Map(cloud.map((row) => [row.id, row]));
      const outcome: SyncOutcome = { pushed: 0, pulled: 0, overwrittenByCloud: [], conflictCopies: [], errors: [], cloud };

      for (const local of all) {
        const project = parseStoredProject(local.projectJson);
        if (!project) { outcome.errors.push(`${local.id}: 本地数据无法解析，已跳过同步`); continue; }
        const remoteMeta = cloudById.get(local.id);
        const baseRevision = local.revision ?? 0;
        if (local.syncState === 'dirty' || (local.syncState === 'conflict' && baseRevision === 0)) {
          try {
            const response = await api.putDesign(local.id, local.name, project, baseRevision);
            await storePutResult(local, project, response);
            const meta: CloudDesignMeta = { id: local.id, name: local.name, width: project.pattern.width, height: project.pattern.height, updatedAt: response.updatedAt, deleted: false, revision: response.revision };
            cloudById.set(local.id, meta);
            const index = outcome.cloud.findIndex((item) => item.id === local.id);
            if (index >= 0) outcome.cloud[index] = meta; else outcome.cloud.push(meta);
            outcome.pushed++;
          } catch (error) {
            if (error instanceof ApiError && error.status === 409 && error.code === 'REVISION_CONFLICT') {
              await resolvePutConflict(local, project, outcome);
            }
            else outcome.errors.push(`${local.id}: ${error instanceof Error ? error.message : '推送失败'}`);
          }
          continue;
        }
        if (!remoteMeta) {
          if (baseRevision > 0) {
            await applyRemoteDeletion(local, outcome);
            outcome.pulled++;
            outcome.overwrittenByCloud.push(local.id);
          }
          continue;
        }
        if (remoteMeta.revision <= baseRevision) continue;
        if (remoteMeta.deleted) await applyRemoteDeletion(local, outcome);
        else {
          const remote = await api.getDesign(local.id);
          if (remote) await storePulledRemote(local, remote, outcome);
        }
        outcome.pulled++;
        outcome.overwrittenByCloud.push(local.id);
      }

      const localIds = new Set([...all.map((row) => row.id), ...tombstones.map((row) => row.id)]);
      for (const remoteMeta of cloud) {
        if (localIds.has(remoteMeta.id) || remoteMeta.deleted) continue;
        const remote = await api.getDesign(remoteMeta.id);
        if (remote) { await storeRemote(remote); outcome.pulled++; }
      }

      const remainingTombstones: TombstoneShape[] = [];
      for (const tombstone of tombstones) {
        const remote = cloudById.get(tombstone.id);
        if (!remote) continue;
        try {
          const response = await api.deleteDesign(tombstone.id, tombstone.baseRevision);
          const current = cloudById.get(tombstone.id);
          if (current) {
            const deleted = { ...current, name: '', width: 0, height: 0, deleted: true, revision: response.revision, updatedAt: response.updatedAt };
            cloudById.set(tombstone.id, deleted);
            const index = outcome.cloud.findIndex((item) => item.id === tombstone.id);
            if (index >= 0) outcome.cloud[index] = deleted;
          }
          outcome.pushed++;
        }
        catch (error) {
          if (error instanceof ApiError && error.status === 409 && error.code === 'REVISION_CONFLICT') {
            const current = await api.getDesign(tombstone.id);
            if (current) await storeRemote(current);
            outcome.overwrittenByCloud.push(tombstone.id);
          } else {
            remainingTombstones.push(tombstone);
            outcome.errors.push(`${tombstone.id}: ${error instanceof Error ? error.message : '删除失败'}`);
          }
        }
      }
      await saveTombstones(remainingTombstones);
      return outcome;
    },
    async pullDesign(id: string): Promise<void> {
      const full = await api.getDesign(id);
      if (!full) throw new ApiError(404, 'NOT_FOUND', '设计不存在');
      // The cloud GET is intentionally outside IndexedDB. A different tab may
      // save this id while the request is in flight; never turn that newer local
      // row into a silent cloud overwrite (which would also clear its source).
      const local = (await storage.getAll()).find((record) => record.id === id);
      if (local) return;
      await storeRemote(full);
    },
    async deleteLocal(id: string, _nowIso?: string, baseRevisionHint = 0): Promise<void> {
      const local = (await storage.getAll()).find((record) => record.id === id);
      const baseRevision = Math.max(local?.revision ?? 0, baseRevisionHint);
      if (baseRevision > 0) {
        const tombstones = await loadTombstones();
        await saveTombstones([...tombstones.filter((item) => item.id !== id), { id, baseRevision }]);
      }
      await storage.delete(id);
    },
    async renameLocal(id: string, name: string, nowIso: string): Promise<void> {
      const record = (await storage.getAll()).find((item) => item.id === id);
      if (!record) throw new ApiError(404, 'NOT_FOUND', '设计不存在');
      const project = parseStoredProject(record.projectJson);
      if (!project) throw new ApiError(400, 'VALIDATION', '本地数据无法解析');
      await storage.put({ ...record, name, projectJson: JSON.stringify({ ...project, name, updatedAt: nowIso }), updatedAt: nowIso, syncState: 'dirty' });
    },
  };
}

export type SyncClient = ReturnType<typeof createSyncClient>;
