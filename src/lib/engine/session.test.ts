import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_GENERATION_PARAMS, type Pattern } from '@/lib/types';
import {
  createGenerationSession,
  generationSessionReducer,
  LatestGenerationTask,
  selectCommittedSnapshot,
  type GenerationCommit,
} from './session';

const source = { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) };

const pattern = (hex = '#FFFFFF'): Pattern => ({
  width: 1,
  height: 1,
  cells: [{ hex, code: 'A', transparent: false }],
});

const commit = (targetWidth = 20): GenerationCommit => ({
  boardProfile: '5mm-29',
  params: { ...DEFAULT_GENERATION_PARAMS, targetWidth },
  paletteSelection: {
    palette: { kind: 'builtin', brand: 'MARD' },
    kitTier: 0,
  },
  pattern: pattern(),
  stats: [{ hex: '#FFFFFF', code: 'A', count: 1 }],
  total: 1,
  engineVersion: '2.0.0',
});

describe('generationSessionReducer', () => {
  it('failed replacement of a source-less design remains locked through remap and undo', () => {
    const before = commit(20);
    let state = generationSessionReducer(createGenerationSession(), { type: 'restore', commit: before });
    state = generationSessionReducer(state, { type: 'replace-source', source, draft: before });
    state = generationSessionReducer(state, { type: 'start', taskId: 1, draft: before });
    state = generationSessionReducer(state, { type: 'failure', taskId: 1, error: 'failed' });
    expect(state).toMatchObject({ status: 'restored-locked', source: null, sourceAvailable: false });
    state = generationSessionReducer(state, { type: 'remap', ...before });
    state = generationSessionReducer(state, { type: 'undo-regeneration' });
    expect(state).toMatchObject({ status: 'restored-locked', source: null, sourceAvailable: false });
  });
  it.each(['failure', 'cancel', 'undo'] as const)('source replacement %s restores the matching previous source and pattern', (ending) => {
    const before = commit(20);
    const after = commit(40);
    const nextSource = { ...source, data: new Uint8ClampedArray([0, 0, 0, 255]) };
    let state = generationSessionReducer(createGenerationSession(), { type: 'restore', commit: before });
    state = generationSessionReducer(state, { type: 'reupload', source, draft: before });
    state = generationSessionReducer(state, { type: 'replace-source', source: nextSource, draft: after });
    state = generationSessionReducer(state, { type: 'start', taskId: 1, draft: after });
    if (ending === 'undo') {
      state = generationSessionReducer(state, { type: 'success', taskId: 1, commit: after });
      expect(state.source).toBe(nextSource);
      state = generationSessionReducer(state, { type: 'undo-regeneration' });
    } else state = generationSessionReducer(state, ending === 'failure'
      ? { type: 'failure', taskId: 1, error: 'failed' }
      : { type: 'cancel', taskId: 1 });
    expect(state.source).toBe(source);
    expect(state.committed).toBe(before);
  });
  it('owns the draft before upload and resets a new upload without a UI mirror', () => {
    const initial = commit(20);
    const changed = commit(40);
    let state = createGenerationSession(initial);

    expect(state).toMatchObject({ status: 'no-source', draft: initial, source: null });
    state = generationSessionReducer(state, { type: 'update-draft', draft: changed });
    expect(state.draft).toEqual(changed);
    state = generationSessionReducer(state, { type: 'upload', source, draft: changed });
    expect(state).toMatchObject({ status: 'ready', source, draft: changed, committed: null });
    state = generationSessionReducer(state, { type: 'upload', source: null, draft: initial });
    expect(state).toMatchObject({ status: 'no-source', source: null, draft: initial, committed: null });
  });

  it('reupload binds pixels to a restored commit without discarding it', () => {
    const restored = commit(20);
    const draft = commit(40);
    let state = generationSessionReducer(createGenerationSession(), { type: 'restore', commit: restored });
    state = generationSessionReducer(state, { type: 'reupload', source, draft });

    expect(state).toMatchObject({ status: 'committed', source, draft, committed: restored });
  });

  it('rejects draft mutation while a task is active or a restored project is locked', () => {
    const stable = commit(20);
    const changed = commit(40);
    const locked = generationSessionReducer(createGenerationSession(), { type: 'restore', commit: stable });
    expect(generationSessionReducer(locked, { type: 'update-draft', draft: changed })).toBe(locked);

    let active = generationSessionReducer(createGenerationSession(stable), { type: 'upload', source, draft: stable });
    active = generationSessionReducer(active, { type: 'start', taskId: 1, draft: changed });
    expect(generationSessionReducer(active, { type: 'update-draft', draft: stable })).toBe(active);
  });

  it('commits params, palette and pattern as one latest-task snapshot', () => {
    const draft = commit(40);
    let state = createGenerationSession();
    state = generationSessionReducer(state, { type: 'upload', source, draft });
    state = generationSessionReducer(state, { type: 'start', taskId: 1, draft });
    state = generationSessionReducer(state, { type: 'success', taskId: 1, commit: draft });

    expect(state.status).toBe('committed');
    expect(selectCommittedSnapshot(state)).toEqual(draft);
  });

  it('ignores progress and results from an obsolete task', () => {
    const first = commit(20);
    const latest = commit(80);
    let state = generationSessionReducer(createGenerationSession(), { type: 'upload', source, draft: first });
    state = generationSessionReducer(state, { type: 'start', taskId: 1, draft: first });
    state = generationSessionReducer(state, { type: 'start', taskId: 2, draft: latest });
    state = generationSessionReducer(state, { type: 'progress', taskId: 1, percent: 90 });
    state = generationSessionReducer(state, { type: 'success', taskId: 1, commit: first });

    expect(state.activeTaskId).toBe(2);
    expect(state.progress).toBeNull();
    expect(state.draft?.params.targetWidth).toBe(80);
  });

  it('cancels generation, rolls the draft back and hides the save/export snapshot while active', () => {
    const stable = commit(20);
    const draft = commit(100);
    let state = generationSessionReducer(createGenerationSession(), { type: 'restore', commit: stable });
    state = generationSessionReducer(state, { type: 'reupload', source, draft: stable });
    state = generationSessionReducer(state, { type: 'start', taskId: 7, draft });

    expect(selectCommittedSnapshot(state)).toBeNull();
    state = generationSessionReducer(state, { type: 'cancel', taskId: 7 });

    expect(state.status).toBe('committed');
    expect(state.draft?.params.targetWidth).toBe(20);
    expect(selectCommittedSnapshot(state)).toEqual(stable);
  });

  it('locks a restored project until a source is supplied', () => {
    const restored = commit();
    let state = generationSessionReducer(createGenerationSession(), { type: 'restore', commit: restored });
    state = generationSessionReducer(state, { type: 'start', taskId: 1, draft: commit(40) });

    expect(state.status).toBe('restored-locked');
    expect(state.source).toBeNull();
    expect(state.activeTaskId).toBeNull();
    expect(selectCommittedSnapshot(state)).toEqual(restored);
  });

  it('keeps manual edits inside the committed snapshot', () => {
    const restored = commit();
    let state = generationSessionReducer(createGenerationSession(), { type: 'restore', commit: restored });
    state = generationSessionReducer(state, {
      type: 'manual-edit',
      pattern: pattern('#000000'),
      stats: [{ hex: '#000000', code: 'B', count: 1 }],
      total: 1,
    });

    expect(state.hasManualEdits).toBe(true);
    expect(selectCommittedSnapshot(state)?.pattern.cells[0].hex).toBe('#000000');
  });

  it('retains a manually edited pre-regeneration snapshot for one-step undo', () => {
    const original = commit(20);
    const regenerated = { ...commit(40), pattern: pattern('#00FF00') };
    let state = generationSessionReducer(createGenerationSession(), { type: 'restore', commit: original });
    state = generationSessionReducer(state, { type: 'manual-edit', pattern: pattern('#000000'), stats: [], total: 1 });
    const edited = state.committed!;
    state = generationSessionReducer(state, { type: 'reupload', source, draft: edited });
    state = generationSessionReducer(state, { type: 'start', taskId: 9, draft: regenerated });
    state = generationSessionReducer(state, { type: 'success', taskId: 9, commit: regenerated });

    expect(state.regenerationUndo).toEqual(edited);
    state = generationSessionReducer(state, { type: 'undo-regeneration' });
    expect(state.committed).toEqual(edited);
    expect(state.hasManualEdits).toBe(true);
    expect(state.regenerationUndo).toBeNull();
  });

  it('switches palette and board profile in one remap snapshot and undoes both together', () => {
    const original = commit();
    let state = generationSessionReducer(createGenerationSession(), { type: 'restore', commit: original });
    state = generationSessionReducer(state, {
      type: 'remap',
      pattern: pattern('#000000'),
      stats: [{ hex: '#000000', code: 'M1', count: 1 }],
      total: 1,
      paletteSelection: {
        palette: {
          kind: 'builtin',
          brand: 'pcd:artkal-m-221-official@178dafbc9e77d3de556550dbd058270200129186',
        },
        kitTier: 24,
      },
      boardProfile: '2.6mm-50',
    });

    expect(state.committed?.boardProfile).toBe('2.6mm-50');
    expect(state.committed?.paletteSelection.kitTier).toBe(24);
    expect(state.regenerationUndo?.boardProfile).toBe('5mm-29');
    state = generationSessionReducer(state, { type: 'undo-regeneration' });
    expect(state.status).toBe('restored-locked');
    expect(state.committed?.boardProfile).toBe('5mm-29');
    expect(state.committed?.paletteSelection).toEqual({
      palette: { kind: 'builtin', brand: 'MARD' },
      kitTier: 0,
    });
    expect(state.hasManualEdits).toBe(false);
  });

  it('invalidates an older remap undo snapshot after new manual edits', () => {
    const original = commit();
    let state = generationSessionReducer(createGenerationSession(), { type: 'restore', commit: original });
    state = generationSessionReducer(state, {
      type: 'remap',
      pattern: pattern('#000000'),
      stats: [{ hex: '#000000', code: 'B', count: 1 }],
      total: 1,
      paletteSelection: {
        palette: { kind: 'custom', colors: [{ hex: '#000000', code: 'B' }] },
        kitTier: 0,
      },
      boardProfile: '5mm-29',
    });
    expect(state.regenerationUndo).toEqual(original);

    state = generationSessionReducer(state, {
      type: 'manual-edit',
      pattern: pattern('#00FF00'),
      stats: [{ hex: '#00FF00', code: 'C', count: 1 }],
      total: 1,
    });

    expect(state.regenerationUndo).toBeNull();
    expect(state.committed?.pattern.cells[0].hex).toBe('#00FF00');
  });

  it('owns the bounded source and releases it when a project is restored without original pixels', () => {
    const draft = commit();
    let state = generationSessionReducer(createGenerationSession(), { type: 'upload', source, draft });
    expect(state.source).toBe(source);
    state = generationSessionReducer(state, { type: 'restore', commit: draft });
    expect(state.sourceAvailable).toBe(false);
    expect(state.source).toBeNull();
  });
});

describe('LatestGenerationTask', () => {
  it('cancels the previous task and never emits its stale result', async () => {
    const owner = new LatestGenerationTask<number>();
    let resolveFirst!: (value: number) => void;
    let resolveSecond!: (value: number) => void;
    const cancelFirst = vi.fn();
    const successes: Array<[number, number]> = [];
    const handlers = {
      onStart: vi.fn(),
      onProgress: vi.fn(),
      onSuccess: (taskId: number, result: number) => { successes.push([taskId, result]); },
      onFailure: vi.fn(),
      onSettled: vi.fn(),
    };
    const firstId = owner.start(() => ({
      promise: new Promise<number>((resolve) => { resolveFirst = resolve; }),
      cancel: cancelFirst,
    }), handlers);
    const secondId = owner.start(() => ({
      promise: new Promise<number>((resolve) => { resolveSecond = resolve; }),
      cancel: vi.fn(),
    }), handlers);

    expect(cancelFirst).toHaveBeenCalledOnce();
    resolveFirst(1);
    resolveSecond(2);
    await Promise.resolve();
    await Promise.resolve();

    expect(secondId).toBeGreaterThan(firstId);
    expect(successes).toEqual([[secondId, 2]]);
  });

  it('returns the active task id on cancellation and ignores later progress', async () => {
    const owner = new LatestGenerationTask<number>();
    let report!: (percent: number) => void;
    const cancel = vi.fn();
    const handlers = {
      onStart: vi.fn(), onProgress: vi.fn(), onSuccess: vi.fn(), onFailure: vi.fn(), onSettled: vi.fn(),
    };
    const id = owner.start((onProgress) => {
      report = onProgress;
      return { promise: new Promise<number>(() => undefined), cancel };
    }, handlers);

    expect(owner.cancel()).toBe(id);
    report(90);
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
    expect(handlers.onProgress).not.toHaveBeenCalled();
  });
});
