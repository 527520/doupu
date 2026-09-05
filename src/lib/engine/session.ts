import type {
  GenerationParams,
  BoardProfileId,
  PaletteSelection,
  Pattern,
  PatternStatsItem,
} from '@/lib/types';
import type { ImageDataLike } from './types';

export type GenerationSessionStatus =
  | 'no-source'
  | 'ready'
  | 'generating'
  | 'committed'
  | 'failed'
  | 'restored-locked';

/** The only serializable/output-facing unit of generation state. */
export interface GenerationDraft {
  boardProfile: BoardProfileId;
  params: GenerationParams;
  /** Persisted palette identity and reproducible packaged-color subset. */
  paletteSelection: PaletteSelection;
}

export interface GenerationCommit extends GenerationDraft {
  pattern: Pattern;
  stats: PatternStatsItem[];
  total: number;
  engineVersion: string;
}

export interface GenerationSessionState {
  status: GenerationSessionStatus;
  sourceAvailable: boolean;
  /** Bounded decoded source owned by the session; restored files deliberately have none. */
  source: ImageDataLike | null;
  /** Source paired with the committed pattern; a replacement is staged until success. */
  committedSource: ImageDataLike | null;
  regenerationUndoSource: ImageDataLike | null;
  draft: GenerationDraft | null;
  committed: GenerationCommit | null;
  /** Draft to restore if the active task is cancelled or fails. */
  lastStableDraft: GenerationDraft | null;
  activeTaskId: number | null;
  progress: number | null;
  error: string | null;
  hasManualEdits: boolean;
  /** One-step recovery of manual work replaced by a confirmed regeneration. */
  regenerationUndo: GenerationCommit | null;
  /** Manual-edit flag belonging to regenerationUndo; profile-only undo must not invent edits. */
  regenerationUndoHasManualEdits: boolean;
  /** A remap of a source-less restored project must return to the locked state on undo. */
  regenerationUndoWasRestoredLocked: boolean;
}

export type GenerationSessionAction =
  | { type: 'upload'; source: ImageDataLike | null; draft: GenerationDraft }
  | { type: 'reupload'; source: ImageDataLike; draft: GenerationDraft }
  | { type: 'replace-source'; source: ImageDataLike; draft: GenerationDraft }
  | { type: 'update-draft'; draft: GenerationDraft }
  | { type: 'start'; taskId: number; draft: GenerationDraft }
  | { type: 'progress'; taskId: number; percent: number }
  | { type: 'success'; taskId: number; commit: GenerationCommit }
  | { type: 'failure'; taskId: number; error: string }
  | { type: 'cancel'; taskId: number }
  | { type: 'restore'; commit: GenerationCommit }
  | { type: 'manual-edit'; pattern: Pattern; stats: PatternStatsItem[]; total: number }
  /**
   * 图纸级换色板（H-1）：不重新采样原图，只把每格换成新色板最近色。
   * 因此不需要生成源，也不会丢手工修补；上一版图纸进 regenerationUndo 供一步撤销。
   */
  | {
      type: 'remap';
      pattern: Pattern;
      stats: PatternStatsItem[];
      total: number;
      paletteSelection: PaletteSelection;
      boardProfile: BoardProfileId;
    }
  | { type: 'undo-regeneration' };

export const createGenerationSession = (draft: GenerationDraft | null = null): GenerationSessionState => ({
  status: 'no-source',
  sourceAvailable: false,
  source: null,
  committedSource: null,
  regenerationUndoSource: null,
  draft,
  committed: null,
  lastStableDraft: draft,
  activeTaskId: null,
  progress: null,
  error: null,
  hasManualEdits: false,
  regenerationUndo: null,
  regenerationUndoHasManualEdits: false,
  regenerationUndoWasRestoredLocked: false,
});

const completedStatus = (state: GenerationSessionState): GenerationSessionStatus =>
  state.committed ? (state.committedSource ? 'committed' : 'restored-locked') : 'ready';

export function generationSessionReducer(
  state: GenerationSessionState,
  action: GenerationSessionAction,
): GenerationSessionState {
  switch (action.type) {
    case 'upload':
      if (!action.source) return createGenerationSession(action.draft);
      return {
        ...createGenerationSession(action.draft),
        status: 'ready',
        sourceAvailable: true,
        source: action.source,
      };
    case 'reupload':
    case 'replace-source':
      return {
        ...state,
        status: state.committed ? 'committed' : 'ready',
        sourceAvailable: true,
        source: action.source,
        committedSource: action.type === 'reupload' && state.committed ? action.source : state.committedSource,
        draft: action.draft,
        lastStableDraft: action.draft,
        activeTaskId: null,
        progress: null,
        error: null,
      };
    case 'update-draft':
      if (state.status === 'generating' || state.status === 'restored-locked') return state;
      return {
        ...state,
        draft: action.draft,
        lastStableDraft: state.committed ?? action.draft,
      };
    case 'start': {
      if (!state.sourceAvailable) return state;
      const stable = state.status === 'generating'
        ? state.lastStableDraft
        : (state.committed ?? state.draft);
      return {
        ...state,
        status: 'generating',
        draft: action.draft,
        lastStableDraft: stable,
        activeTaskId: action.taskId,
        progress: null,
        error: null,
      };
    }
    case 'progress':
      if (state.status !== 'generating' || state.activeTaskId !== action.taskId) return state;
      return { ...state, progress: Math.max(0, Math.min(100, action.percent)) };
    case 'success':
      if (state.status !== 'generating' || state.activeTaskId !== action.taskId) return state;
      return {
        ...state,
        status: 'committed',
        draft: action.commit,
        committed: action.commit,
        committedSource: state.source,
        lastStableDraft: action.commit,
        activeTaskId: null,
        progress: null,
        error: null,
        hasManualEdits: false,
        regenerationUndo: state.hasManualEdits || state.source !== state.committedSource ? state.committed : null,
        regenerationUndoSource: state.committedSource,
        regenerationUndoHasManualEdits: state.hasManualEdits,
        regenerationUndoWasRestoredLocked: state.committedSource === null && state.committed !== null,
      };
    case 'failure':
      if (state.status !== 'generating' || state.activeTaskId !== action.taskId) return state;
      return {
        ...state,
        status: state.committed && !state.committedSource ? 'restored-locked' : 'failed',
        source: state.committed ? state.committedSource : state.source,
        sourceAvailable: state.committed ? state.committedSource !== null : state.sourceAvailable,
        draft: state.lastStableDraft,
        activeTaskId: null,
        progress: null,
        error: action.error,
      };
    case 'cancel':
      if (state.status !== 'generating' || state.activeTaskId !== action.taskId) return state;
      return {
        ...state,
        status: completedStatus(state),
        source: state.committed ? state.committedSource : state.source,
        sourceAvailable: state.committed ? state.committedSource !== null : state.sourceAvailable,
        draft: state.lastStableDraft,
        activeTaskId: null,
        progress: null,
        error: null,
      };
    case 'restore':
      return {
        status: 'restored-locked',
        sourceAvailable: false,
        source: null,
        committedSource: null,
        regenerationUndoSource: null,
        draft: action.commit,
        committed: action.commit,
        lastStableDraft: action.commit,
        activeTaskId: null,
        progress: null,
        error: null,
        hasManualEdits: false,
        regenerationUndo: null,
        regenerationUndoHasManualEdits: false,
        regenerationUndoWasRestoredLocked: false,
      };
    case 'manual-edit':
      if (!state.committed || state.status === 'generating') return state;
      return {
        ...state,
        committed: {
          ...state.committed,
          pattern: action.pattern,
          stats: action.stats,
          total: action.total,
        },
        hasManualEdits: true,
        // The one-step snapshot predates this new manual work. Keeping it
        // actionable would let a later click silently discard the edits.
        regenerationUndo: null,
        regenerationUndoSource: null,
        regenerationUndoHasManualEdits: false,
        regenerationUndoWasRestoredLocked: false,
      };
    case 'remap': {
      // 换色板：committed 与 draft 一起换成新色板，图纸格子由调用方重映射好。
      // 生成源与 status 保持不变（有源的会话仍可继续重新生成）。
      if (!state.committed || state.status === 'generating') return state;
      const next: GenerationCommit = {
        ...state.committed,
        pattern: action.pattern,
        stats: action.stats,
        total: action.total,
        paletteSelection: action.paletteSelection,
        boardProfile: action.boardProfile,
      };
      return {
        ...state,
        draft: {
          params: next.params,
          paletteSelection: action.paletteSelection,
          boardProfile: action.boardProfile,
        },
        committed: next,
        lastStableDraft: {
          params: next.params,
          paletteSelection: action.paletteSelection,
          boardProfile: action.boardProfile,
        },
        error: null,
        regenerationUndo: state.committed,
        regenerationUndoSource: state.committedSource,
        regenerationUndoHasManualEdits: state.hasManualEdits,
        regenerationUndoWasRestoredLocked: state.committedSource === null,
      };
    }
    case 'undo-regeneration':
      if (!state.regenerationUndo || state.status === 'generating') return state;
      return {
        ...state,
        status: state.regenerationUndoWasRestoredLocked ? 'restored-locked' : 'committed',
        draft: state.regenerationUndo,
        committed: state.regenerationUndo,
        source: state.regenerationUndoSource,
        committedSource: state.regenerationUndoSource,
        sourceAvailable: state.regenerationUndoSource !== null,
        lastStableDraft: state.regenerationUndo,
        error: null,
        hasManualEdits: state.regenerationUndoHasManualEdits,
        regenerationUndo: null,
        regenerationUndoSource: null,
        regenerationUndoHasManualEdits: false,
        regenerationUndoWasRestoredLocked: false,
      };
  }
}

/** Save and export must never observe a draft paired with an older pattern. */
export const selectCommittedSnapshot = (
  state: GenerationSessionState,
): GenerationCommit | null => state.status === 'generating' ? null : state.committed;

export interface CancellableGenerationTask<Result> {
  promise: Promise<Result>;
  cancel(): void;
}

export interface GenerationTaskHandlers<Result> {
  onStart(taskId: number): void;
  onProgress(taskId: number, percent: number): void;
  onSuccess(taskId: number, result: Result): void;
  onFailure(taskId: number, error: unknown): void;
  onSettled(taskId: number): void;
}

/**
 * Owns the only active generation task and its monotonically increasing id.
 * UI components receive lifecycle events but cannot accidentally retain or
 * overwrite a stale Worker handle/token.
 */
export class LatestGenerationTask<Result> {
  private nextTaskId = 0;
  private active: { taskId: number; task: CancellableGenerationTask<Result> } | null = null;

  start(
    create: (onProgress: (percent: number) => void) => CancellableGenerationTask<Result>,
    handlers: GenerationTaskHandlers<Result>,
  ): number {
    this.cancel();
    const taskId = ++this.nextTaskId;
    handlers.onStart(taskId);
    let task: CancellableGenerationTask<Result>;
    try {
      task = create((percent) => {
        if (this.active?.taskId === taskId) handlers.onProgress(taskId, percent);
      });
    } catch (error) {
      handlers.onFailure(taskId, error);
      handlers.onSettled(taskId);
      return taskId;
    }
    this.active = { taskId, task };
    void task.promise
      .then((result) => {
        if (this.active?.taskId === taskId) handlers.onSuccess(taskId, result);
      })
      .catch((error: unknown) => {
        if (this.active?.taskId === taskId) handlers.onFailure(taskId, error);
      })
      .finally(() => {
        if (this.active?.taskId !== taskId) return;
        this.active = null;
        handlers.onSettled(taskId);
      });
    return taskId;
  }

  cancel(): number | null {
    const current = this.active;
    if (!current) return null;
    this.active = null;
    current.task.cancel();
    return current.taskId;
  }
}
