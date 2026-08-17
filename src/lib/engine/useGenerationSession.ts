'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  createGenerationSession,
  generationSessionReducer,
  LatestGenerationTask,
  type CancellableGenerationTask,
  type GenerationCommit,
  type GenerationDraft,
  type GenerationSessionAction,
} from './session';
import type { ImageDataLike } from './types';
import type { Pattern, PatternStatsItem } from '@/lib/types';

interface GenerateOptions<Result> {
  create(source: ImageDataLike, draft: GenerationDraft, onProgress: (percent: number) => void): CancellableGenerationTask<Result>;
  commit(result: Result, draft: GenerationDraft): GenerationCommit;
  errorMessage: string;
  onStart?(): void;
  onProgress?(percent: number): void;
  onSuccess?(commit: GenerationCommit): void;
  onFailure?(error: unknown, stableDraft: GenerationDraft | null): void;
  onSettled?(): void;
}

export interface CancelledGeneration {
  taskId: number;
  hadCommit: boolean;
  stableDraft: GenerationDraft | null;
}

/**
 * React adapter for the deep generation-session module. It owns the reducer,
 * the only task instance/token and synchronous state mirror; Workbench only
 * projects committed state into UI and supplies rendering callbacks.
 */
export function useGenerationSession<Result>(initialDraft: GenerationDraft) {
  const [state, reactDispatch] = useReducer(
    generationSessionReducer,
    initialDraft,
    createGenerationSession,
  );
  const stateRef = useRef(state);
  const [tasks] = useState(() => new LatestGenerationTask<Result>());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dispatch = useCallback((action: GenerationSessionAction): void => {
    // Promise callbacks can run before React commits the previous dispatch.
    // Keep the module's canonical state synchronous without UI-owned mirrors.
    stateRef.current = generationSessionReducer(stateRef.current, action);
    reactDispatch(action);
  }, []);

  const generate = useCallback((options: GenerateOptions<Result>): number | null => {
    const current = stateRef.current;
    const draft = current.draft;
    const source = current.source;
    if (!draft || !source || !current.sourceAvailable) return null;
    return tasks.start(
    (onProgress) => options.create(source, draft, onProgress),
    {
      onStart: (taskId) => {
        dispatch({ type: 'start', taskId, draft });
        options.onStart?.();
      },
      onProgress: (taskId, percent) => {
        dispatch({ type: 'progress', taskId, percent });
        options.onProgress?.(percent);
      },
      onSuccess: (taskId, result) => {
        const commit = options.commit(result, draft);
        dispatch({ type: 'success', taskId, commit });
        options.onSuccess?.(commit);
      },
      onFailure: (taskId, error) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        const stableDraft = stateRef.current.lastStableDraft;
        dispatch({ type: 'failure', taskId, error: options.errorMessage });
        options.onFailure?.(error, stableDraft);
      },
      onSettled: () => options.onSettled?.(),
    },
  );
  }, [dispatch, tasks]);

  const cancel = useCallback((): CancelledGeneration | null => {
    const before = stateRef.current;
    const taskId = tasks.cancel();
    if (taskId === null) return null;
    dispatch({ type: 'cancel', taskId });
    return {
      taskId,
      hadCommit: before.committed !== null,
      stableDraft: before.lastStableDraft,
    };
  }, [dispatch, tasks]);

  const upload = useCallback((source: ImageDataLike | null, draft: GenerationDraft): void => {
    tasks.cancel();
    dispatch({ type: 'upload', source, draft });
  }, [dispatch, tasks]);
  const reupload = useCallback((source: ImageDataLike, draft: GenerationDraft): void => {
    tasks.cancel();
    dispatch({ type: 'reupload', source, draft });
  }, [dispatch, tasks]);
  const updateDraft = useCallback((draft: GenerationDraft): void => {
    dispatch({ type: 'update-draft', draft });
  }, [dispatch]);
  const restore = useCallback((commit: GenerationCommit): void => {
    tasks.cancel();
    dispatch({ type: 'restore', commit });
  }, [dispatch, tasks]);
  const commitManualEdit = useCallback((pattern: Pattern, stats: PatternStatsItem[], total: number): void => {
    dispatch({ type: 'manual-edit', pattern, stats, total });
  }, [dispatch]);
  const undoRegeneration = useCallback((): void => {
    dispatch({ type: 'undo-regeneration' });
  }, [dispatch]);
  useEffect(() => () => {
    tasks.cancel();
  }, [tasks]);

  return {
    state,
    generate,
    cancel,
    upload,
    reupload,
    updateDraft,
    restore,
    commitManualEdit,
    undoRegeneration,
  } as const;
}
