import type { StitchProgress } from './stitchProgress';

export const DEFAULT_STITCH_HISTORY_LIMIT = 100;

export interface StitchHistory {
  readonly past: readonly StitchProgress[];
  readonly current: StitchProgress;
  readonly future: readonly StitchProgress[];
  readonly limit: number;
}

function snapshot(progress: StitchProgress): StitchProgress {
  return { ...progress, done: progress.done.slice() };
}

export function createStitchHistory(
  initial: StitchProgress,
  limit = DEFAULT_STITCH_HISTORY_LIMIT,
): StitchHistory {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : DEFAULT_STITCH_HISTORY_LIMIT;
  return { past: [], current: snapshot(initial), future: [], limit: normalizedLimit };
}

export function canUndoStitchHistory(history: StitchHistory): boolean {
  return history.past.length > 0;
}

export function canRedoStitchHistory(history: StitchHistory): boolean {
  return history.future.length > 0;
}

/** 记录一次完成的用户操作；同一对象表示领域操作无变化，不制造空历史。 */
export function commitStitchHistory(history: StitchHistory, next: StitchProgress): StitchHistory {
  if (next === history.current) return history;
  return {
    ...history,
    past: [...history.past, snapshot(history.current)].slice(-history.limit),
    current: snapshot(next),
    future: [],
  };
}

export function undoStitchHistory(history: StitchHistory): StitchHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    ...history,
    past: history.past.slice(0, -1),
    current: snapshot(previous),
    future: [snapshot(history.current), ...history.future],
  };
}

export function redoStitchHistory(history: StitchHistory): StitchHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    ...history,
    past: [...history.past, snapshot(history.current)].slice(-history.limit),
    current: snapshot(next),
    future: history.future.slice(1),
  };
}
