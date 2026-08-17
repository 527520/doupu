import { describe, expect, it } from 'vitest';
import { EditHistory } from './history';
import { makeSolid } from './ops';
import {
  clearPattern,
  createEditorState,
  fillAt,
  paintBrush,
  replaceCode,
  undoEdit,
} from './state';
import type { PaletteColor, Pattern } from '@/lib/types';

const RED: PaletteColor = { hex: '#FF0000', code: 'A' };
const BLUE: PaletteColor = { hex: '#0000FF', code: 'B' };

function patternOf(width: number, height: number): Pattern {
  return {
    width,
    height,
    cells: Array.from({ length: width * height }, () => makeSolid(RED.hex, RED.code)),
  };
}

describe('EditorState 性能预算（无 coverage instrumentation）', () => {
  it('200×200 核心编辑序列中每个操作 <50ms', () => {
    const state = createEditorState(patternOf(200, 200));
    const history = new EditHistory();
    const probe = (run: () => unknown) => {
      const start = performance.now();
      run();
      expect(performance.now() - start).toBeLessThan(50);
    };

    probe(() => paintBrush(state, history, 100, 100, 3, BLUE));
    probe(() => fillAt(state, history, 0, 0, RED));
    probe(() => replaceCode(state, history, 'B', null));
    probe(() => clearPattern(state, history));
    probe(() => undoEdit(state, history));
  });
});
