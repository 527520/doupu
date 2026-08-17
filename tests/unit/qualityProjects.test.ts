import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import packageJson from '../../package.json';

interface InlineProject {
  test?: { name?: string };
}

async function loadVitestConfig(): Promise<{ test?: { projects?: Array<string | InlineProject> } }> {
  const url = pathToFileURL(resolve(process.cwd(), 'vitest.config.mts')).href;
  const loaded = (await import(url)) as { default: { test?: { projects?: Array<string | InlineProject> } } };
  return loaded.default;
}

describe('可信质量基线配置', () => {
  it('将 unit、serial、integration、performance 定义为独立 Vitest projects', async () => {
    const config = await loadVitestConfig();
    const projects = config.test?.projects ?? [];
    const names = projects
      .filter((project): project is InlineProject => typeof project !== 'string')
      .map((project) => project.test?.name);

    expect(names).toEqual(['unit', 'serial', 'integration', 'performance']);
  });

  it('为 coverage、database integration、performance 提供互不嵌套的命令', () => {
    expect(packageJson.scripts['test:coverage']).toBe(
      'vitest run --coverage --project unit --project serial',
    );
    expect(packageJson.scripts['test:integration']).toBe('vitest run --project integration');
    expect(packageJson.scripts['test:performance']).toBe('vitest run --project performance');
  });
});
