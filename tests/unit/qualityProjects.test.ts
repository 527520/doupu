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
    // coverage 现在也跑 integration：认证/会话/守卫/限流不再被排除在护栏之外（A-14），
    // 因此与 npm run test 一样需要串行（PGlite / argon2 共享进程级 seam）。
    expect(packageJson.scripts['test:coverage']).toBe(
      'vitest run --no-file-parallelism --maxWorkers=1 --coverage --project unit --project serial --project integration',
    );
    expect(packageJson.scripts['test:integration']).toBe('vitest run --project integration');
    expect(packageJson.scripts['test:performance']).toBe('vitest run --project performance');
  });

  it('覆盖率护栏包含认证与限流等安全核心（A-14）', async () => {
    const config = (await loadVitestConfig()) as { test?: { coverage?: { exclude?: string[] } } };
    const excluded = config.test?.coverage?.exclude ?? [];
    for (const file of [
      'src/lib/auth/session.ts',
      'src/lib/auth/transitions.ts',
      'src/lib/auth/guard.ts',
      'src/lib/auth/rateLimit.ts',
      'src/lib/auth/cookies.ts',
    ]) {
      expect(excluded).not.toContain(file);
    }
  });
});
