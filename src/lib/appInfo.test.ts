import { describe, expect, it } from 'vitest';
import { APP_NAME, APP_VERSION, ENGINE_VERSION, LIMITS, PROJECT_FILE_FORMAT, PROJECT_FILE_VERSION, SOURCE_REPO_URL } from './appInfo';

describe('appInfo', () => {
  it('exposes the product identity', () => {
    expect(APP_NAME).toBe('豆谱');
    expect(PROJECT_FILE_FORMAT).toBe('doupu-project');
    expect(PROJECT_FILE_VERSION).toBe(2);
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exposes spec limits consistently', () => {
    expect(LIMITS.targetWidth.min).toBeLessThanOrEqual(LIMITS.targetWidth.max);
    expect(LIMITS.gridCells).toBe(LIMITS.targetWidth.max * LIMITS.targetWidth.max);
    expect(LIMITS.password.min).toBe(8);
    expect(LIMITS.password.max).toBe(72);
    expect(LIMITS.maxFileBytes).toBe(20 * 1024 * 1024);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('points the source repo at the user account', () => {
    expect(SOURCE_REPO_URL).toBe('https://github.com/527520/doupu');
  });
});
