// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useGenerationSession } from './useGenerationSession';
import type { GenerationCommit, GenerationDraft } from './session';
import type { ImageDataLike } from './types';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';

const source: ImageDataLike = {
  data: new Uint8ClampedArray([255, 0, 0, 255]),
  width: 1,
  height: 1,
};
const draft: GenerationDraft = {
  params: { ...DEFAULT_GENERATION_PARAMS, targetWidth: 20 },
  palette: [{ code: 'R', hex: '#FF0000' }],
  projectPalette: { kind: 'custom', colors: [{ code: 'R', hex: '#FF0000' }] },
};
const commit: GenerationCommit = {
  ...draft,
  pattern: { width: 1, height: 1, cells: [{ code: 'R', hex: '#FF0000', transparent: false }] },
  stats: [{ code: 'R', hex: '#FF0000', count: 1 }],
  total: 1,
  engineVersion: '2.0.0',
};

describe('useGenerationSession deep interface', () => {
  it('owns source, task/progress and immutable commit without a UI state mirror', async () => {
    let resolve!: (value: GenerationCommit) => void;
    let progress!: (percent: number) => void;
    const cancel = vi.fn();
    const { result } = renderHook(() => useGenerationSession<GenerationCommit>(draft));

    act(() => result.current.upload(source, draft));
    act(() => {
      result.current.generate({
        create: (_source, _draft, report) => {
          progress = report;
          return { promise: new Promise<GenerationCommit>((done) => { resolve = done; }), cancel };
        },
        commit: (value) => value,
        errorMessage: 'failed',
      });
    });
    expect(result.current.state).toMatchObject({ status: 'generating', source, progress: null });

    act(() => progress(42));
    expect(result.current.state.progress).toBe(42);
    act(() => resolve(commit));
    await waitFor(() => expect(result.current.state.status).toBe('committed'));
    expect(result.current.state.committed).toEqual(commit);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('restore locks regeneration, reupload unlocks the same commit, and clear releases all state', () => {
    const { result } = renderHook(() => useGenerationSession<GenerationCommit>(draft));
    act(() => result.current.restore(commit));
    expect(result.current.state).toMatchObject({ status: 'restored-locked', source: null, committed: commit });

    act(() => result.current.reupload(source, draft));
    expect(result.current.state).toMatchObject({ status: 'committed', source, committed: commit });

    act(() => result.current.upload(null, draft));
    expect(result.current.state).toMatchObject({ status: 'no-source', source: null, committed: null });
  });

  it('exposes only domain actions and cancels the active task on unmount', () => {
    const cancel = vi.fn();
    const { result, unmount } = renderHook(() => useGenerationSession<GenerationCommit>(draft));
    expect(Object.keys(result.current).sort()).toEqual([
      'cancel', 'commitManualEdit', 'generate', 'remapPalette', 'restore', 'reupload', 'state', 'undoRegeneration', 'updateDraft', 'upload',
    ]);
    act(() => result.current.upload(source, draft));
    act(() => {
      result.current.generate({
        create: () => ({ promise: new Promise<GenerationCommit>(() => undefined), cancel }),
        commit: (value) => value,
        errorMessage: 'failed',
      });
    });
    unmount();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
