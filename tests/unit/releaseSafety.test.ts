import { describe, expect, it } from 'vitest';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const read = (path: string): string => readFileSync(path, 'utf8');

/** 跨平台建目录（Windows 的 mkdir 不认 -p，外部命令会静默失败并让后续 copy 抛 ENOENT）。 */
const ensureDirs = (...dirs: string[]): void => {
  for (const dir of dirs) mkdirSync(dir, { recursive: true });
};

/**
 * 部分用例要真的执行 deploy/scripts/*.sh，需要 POSIX shell 与 POSIX 路径语义。
 * 只在 Linux 上执行：Windows 的 CI 镜像带 Git Bash 的 sh（能找到 sh 不代表
 * 脚本里的 PATH 覆盖（/usr/bin:/bin 等）能工作——这些用例把 PATH 换成 POSIX
 * 布局，sh 本身就无法再被解析），因此在 Windows 上一律跳过而不是伪失败。
 * Linux CI 仍会执行它们，门禁不受影响。
 */
const posixShell = process.platform === 'linux' && spawnSync('sh', ['-c', 'exit 0'], { stdio: 'ignore' }).status === 0;
const shellIt = posixShell ? it : it.skip;

describe('backup and release safety gates', () => {
  it('creates, validates and atomically promotes a custom-format backup', () => {
    const script = read('deploy/scripts/backup.sh');
    expect(script).toContain('pg_dump --format=custom');
    expect(script).toContain('pg_restore --list');
    expect(script).toContain('.pending');
    expect(script).toContain('rclone moveto');
    expect(script).not.toMatch(/COS_.+\u8df3\u8fc7\u4e0a\u4f20[\s\S]+exit 0/);
  });

  shellIt('treats a missing production alert channel as a failure', () => {
    const result = spawnSync('sh', ['deploy/scripts/notify.sh', 'test failure'], {
      cwd: process.cwd(),
      env: { ...process.env, BACKUP_ALERT_TOKEN: '', ALERT_ENDPOINT: '' },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
  });

  it('routes remote inspection failures through the backup alert path', () => {
    const script = read('deploy/scripts/backup.sh');
    expect(script).toMatch(/rclone lsl "\$\{PENDING\}"[^\n]*\n?\s*\|\| fail "pending object inspection failed/);
    expect(script).toMatch(/rclone lsl "\$\{FINAL\}"[^\n]*\n?\s*\|\| fail "promoted object inspection failed/);
  });

  shellIt('executes the complete verified backup happy path with isolated adapters', () => {
    const root = mkdtempSync(join(tmpdir(), 'doupu-backup-test-'));
    const bin = join(root, 'bin');
    const remote = join(root, 'remote');
    const makeExecutable = (name: string, body: string): void => {
      const path = join(bin, name);
      writeFileSync(path, `#!/bin/sh\nset -eu\n${body}\n`);
      chmodSync(path, 0o755);
    };
    ensureDirs(bin, remote);
    makeExecutable('pg_dump', `
      for arg in "$@"; do case "$arg" in --file) next=1;; *) if [ "\${next:-0}" = 1 ]; then printf dump > "$arg"; next=0; fi;; esac; done
    `);
    makeExecutable('pg_restore', `
      if [ "\${1:-}" = "--list" ]; then echo 'TABLE public canary'; exit 0; fi
      exit 0
    `);
    makeExecutable('rclone', `
      command=$1; source=$2; target=\${3:-}
      case "$command" in
        copyto) mkdir -p "$(dirname "$target")"; cp "$source" "$target";;
        moveto) mkdir -p "$(dirname "$target")"; mv "$source" "$target";;
        lsl) bytes=$(wc -c < "$source" | tr -d ' '); echo "$bytes 2026-08-17 00:00:00 $(basename "$source")";;
        *) exit 2;;
      esac
    `);

    const result = spawnSync('sh', ['deploy/scripts/backup.sh'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        BACKUP_DESTINATION: remote,
        COS_SECRET_ID: '',
        COS_SECRET_KEY: '',
        COS_BUCKET: '',
        COS_REGION: '',
      },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    const files = readdirSync(remote).filter((name) => name.endsWith('.dump.gz'));
    expect(files).toHaveLength(1);
    expect(existsSync(join(remote, '.pending', files[0]))).toBe(false);
  });

  shellIt.each([
    ['dump', 'pg_dump failed'],
    ['validate', 'pg_restore validation failed'],
    ['compress', 'compression failed'],
    ['upload', 'pending upload failed'],
  ] as const)('%s failure exits non-zero and delivers the backup alert', (stage, expectedMessage) => {
    const root = mkdtempSync(join(tmpdir(), `doupu-backup-${stage}-`));
    const bin = join(root, 'bin');
    const scripts = join(root, 'scripts');
    const remote = join(root, 'remote');
    const alertLog = join(root, 'alerts.log');
    ensureDirs(bin, scripts, remote);

    const makeExecutable = (path: string, body: string): void => {
      writeFileSync(path, `#!/bin/sh\nset -eu\n${body}\n`);
      chmodSync(path, 0o755);
    };
    const backupScript = join(scripts, 'backup.sh');
    copyFileSync('deploy/scripts/backup.sh', backupScript);
    chmodSync(backupScript, 0o755);
    makeExecutable(join(scripts, 'notify.sh'), `printf '%s\\n' "$1" >> "$ALERT_LOG"`);
    makeExecutable(join(bin, 'pg_dump'), `
      [ "\${FAIL_STAGE:-}" != dump ] || exit 21
      next=0
      for arg in "$@"; do
        if [ "$next" = 1 ]; then printf dump > "$arg"; next=0; fi
        [ "$arg" != --file ] || next=1
      done
    `);
    makeExecutable(join(bin, 'pg_restore'), `
      [ "\${FAIL_STAGE:-}" != validate ] || exit 22
      echo 'TABLE public canary'
    `);
    makeExecutable(join(bin, 'gzip'), `
      [ "\${FAIL_STAGE:-}" != compress ] || exit 23
      cat "$2"
    `);
    makeExecutable(join(bin, 'rclone'), `
      [ "\${FAIL_STAGE:-}" != upload ] || exit 24
      exit 0
    `);

    const result = spawnSync('sh', [backupScript], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        FAIL_STAGE: stage,
        ALERT_LOG: alertLog,
        BACKUP_DESTINATION: remote,
      },
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(expectedMessage);
    expect(readFileSync(alertLog, 'utf8')).toContain(`豆谱备份失败：${expectedMessage}`);
    expect(result.stderr).not.toContain('backup alert delivery also failed');
  });

  it('runs migration before replacing the serving app', () => {
    const script = read('deploy/scripts/deploy.sh');
    const migration = script.indexOf('node db/migrate.cjs');
    const cutover = script.indexOf('up -d --force-recreate --no-deps --no-build app');
    expect(migration).toBeGreaterThan(-1);
    expect(cutover).toBeGreaterThan(migration);
    expect(script).not.toContain('docker tag "${OLD_APP_IMAGE}"');
    expect(script).toContain('禁止回滚旧协议镜像');
  });

  shellIt('keeps the serving containers untouched when migration execution fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'doupu-deploy-migration-failure-'));
    const scripts = join(root, 'deploy', 'scripts');
    const bin = join(root, 'bin');
    const deployLog = join(root, 'docker.log');
    ensureDirs(scripts, bin);
    const deployScript = join(scripts, 'deploy.sh');
    copyFileSync('deploy/scripts/deploy.sh', deployScript);
    chmodSync(deployScript, 0o755);
    writeFileSync(join(root, '.env'), 'APP_IMAGE=ghcr.io/527520/doupu:v0.2.0\n');
    const fakeDocker = join(bin, 'docker');
    writeFileSync(fakeDocker, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$DEPLOY_LOG"
case "$*" in
  *'run --rm --no-deps app node db/migrate.cjs'*) exit 42 ;;
  *) exit 0 ;;
esac
`);
    chmodSync(fakeDocker, 0o755);

    const result = spawnSync('bash', [deployScript], {
      cwd: root,
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, DEPLOY_LOG: deployLog },
      encoding: 'utf8',
    });
    const calls = readFileSync(deployLog, 'utf8');
    expect(result.status).toBe(42);
    expect(result.stderr).toContain('数据库迁移失败；现有 Caddy/app 未停止或替换');
    expect(calls).toContain('run --rm --no-deps app node db/migrate.cjs');
    expect(calls).not.toContain('stop caddy');
    expect(calls).not.toContain('up -d --force-recreate --no-deps --no-build app');
    expect(calls).not.toContain('exec -T app');
  });

  it('deploys only a gated immutable GHCR app image and never rebuilds app source on the server', () => {
    const script = read('deploy/scripts/deploy.sh');
    const compose = read('docker-compose.prod.yml');
    const appService = compose.slice(compose.indexOf('  app:'), compose.indexOf('  postgres:'));
    expect(appService).toContain('image: ${APP_IMAGE:?');
    expect(appService).not.toMatch(/\n\s+build:/);
    expect(script).toContain('pull app');
    expect(script).toContain('--no-build app');
    expect(script).not.toContain('"${COMPOSE[@]}" build app');
    expect(script).toContain("^ghcr\\.io/527520/doupu");
    expect(script).toContain(':v[0-9]+');
    expect(read('docs/adr/0005-deployment-tencent-docker.md')).toContain('stable GHCR tag or immutable digest');
    const checklist = read('deploy/CHECKLIST.md');
    expect(checklist).toContain('APP_IMAGE');
    expect(checklist).not.toContain('release-upgrade.ps1');
  });

  it('makes the backup container exit when a backup or its alert path fails', () => {
    const compose = read('docker-compose.prod.yml');
    const backupService = compose.slice(compose.indexOf('  backup:'), compose.indexOf('\nvolumes:'));
    expect(backupService).toContain('entrypoint: ["/scripts/backup-loop.sh"]');
    expect(backupService).toContain('condition: service_healthy');
    expect(backupService).toContain('healthcheck:');
    expect(backupService).toContain('/scripts/backup-healthcheck.sh');
    expect(backupService).not.toContain('|| true');
  });

  shellIt('waits for PostgreSQL and app readiness before the first backup and records success', () => {
    const root = mkdtempSync(join(tmpdir(), 'doupu-backup-loop-'));
    const scripts = join(root, 'scripts');
    const bin = join(root, 'bin');
    const pgAttempts = join(root, 'pg-attempts');
    const appAttempts = join(root, 'app-attempts');
    const backupLog = join(root, 'backup.log');
    const statusFile = join(root, 'last-success');
    ensureDirs(scripts, bin);
    copyFileSync('deploy/scripts/backup-loop.sh', join(scripts, 'backup-loop.sh'));
    chmodSync(join(scripts, 'backup-loop.sh'), 0o755);
    const attemptScript = (counter: string) => `count=0; [ ! -f "${counter}" ] || count=$(cat "${counter}"); count=$((count+1)); echo "$count" > "${counter}"; [ "$count" -ge 2 ]`;
    writeFileSync(join(bin, 'pg_isready'), `#!/bin/sh\n${attemptScript(pgAttempts)}\n`);
    writeFileSync(join(bin, 'curl'), `#!/bin/sh\n${attemptScript(appAttempts)}\n`);
    writeFileSync(join(scripts, 'backup.sh'), `#!/bin/sh\nprintf 'backup\\n' >> "${backupLog}"\n`);
    writeFileSync(join(scripts, 'notify.sh'), '#!/bin/sh\nexit 0\n');
    for (const file of [join(bin, 'pg_isready'), join(bin, 'curl'), join(scripts, 'backup.sh'), join(scripts, 'notify.sh')]) {
      chmodSync(file, 0o755);
    }

    const result = spawnSync('sh', [join(scripts, 'backup-loop.sh')], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        BACKUP_WAIT_ATTEMPTS: '3',
        BACKUP_WAIT_SECONDS: '0',
        BACKUP_RUN_ONCE: 'true',
        BACKUP_STATUS_FILE: statusFile,
        APP_HEALTH_ENDPOINT: 'http://app:3000/',
      },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(pgAttempts, 'utf8').trim()).toBe('2');
    expect(readFileSync(appAttempts, 'utf8').trim()).toBe('2');
    expect(readFileSync(backupLog, 'utf8')).toBe('backup\n');
    expect(readFileSync(statusFile, 'utf8')).toMatch(/^\d+\n$/);
  });

  shellIt('exits non-zero and alerts when backup prerequisites never become ready', () => {
    const root = mkdtempSync(join(tmpdir(), 'doupu-backup-wait-failure-'));
    const scripts = join(root, 'scripts');
    const bin = join(root, 'bin');
    const alertLog = join(root, 'alert.log');
    ensureDirs(scripts, bin);
    copyFileSync('deploy/scripts/backup-loop.sh', join(scripts, 'backup-loop.sh'));
    writeFileSync(join(bin, 'pg_isready'), '#!/bin/sh\nexit 1\n');
    writeFileSync(join(bin, 'curl'), '#!/bin/sh\nexit 1\n');
    writeFileSync(join(scripts, 'backup.sh'), '#!/bin/sh\nexit 99\n');
    writeFileSync(join(scripts, 'notify.sh'), `#!/bin/sh\nprintf '%s\\n' "$1" >> "${alertLog}"\n`);
    for (const file of [join(scripts, 'backup-loop.sh'), join(bin, 'pg_isready'), join(bin, 'curl'), join(scripts, 'backup.sh'), join(scripts, 'notify.sh')]) {
      chmodSync(file, 0o755);
    }
    const result = spawnSync('sh', [join(scripts, 'backup-loop.sh')], {
      cwd: root,
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, BACKUP_WAIT_ATTEMPTS: '2', BACKUP_WAIT_SECONDS: '0' },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('PostgreSQL did not become ready');
    expect(readFileSync(alertLog, 'utf8')).toContain('PostgreSQL did not become ready');
  });

  shellIt('reports backup health only while the last verified success is fresh', () => {
    const root = mkdtempSync(join(tmpdir(), 'doupu-backup-health-'));
    const statusFile = join(root, 'last-success');
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(statusFile, `${now}\n`);
    const fresh = spawnSync('sh', ['deploy/scripts/backup-healthcheck.sh'], {
      cwd: process.cwd(),
      env: { ...process.env, BACKUP_STATUS_FILE: statusFile, BACKUP_MAX_AGE_SECONDS: '129600' },
    });
    expect(fresh.status).toBe(0);
    writeFileSync(statusFile, `${now - 129601}\n`);
    const stale = spawnSync('sh', ['deploy/scripts/backup-healthcheck.sh'], {
      cwd: process.cwd(),
      env: { ...process.env, BACKUP_STATUS_FILE: statusFile, BACKUP_MAX_AGE_SECONDS: '129600' },
    });
    expect(stale.status).not.toBe(0);
  });

  it('reuses the complete CI workflow and validates release version provenance', () => {
    const ci = read('.github/workflows/ci.yml');
    const release = read('.github/workflows/release.yml');
    expect(ci).toContain('workflow_call:');
    expect(ci).toContain('npm run test:coverage:stable');
    expect(ci).toContain('npm run test:performance:stable');
    expect(ci).toContain('npm run test:e2e:stable');
    expect(ci).toContain('cron: "17 3 * * 1"');
    expect(release).toContain('uses: ./.github/workflows/ci.yml');
    expect(release).toContain('verify-release.sh');
    expect(release).toContain('needs: quality');
    const composeBuildStep = ci.slice(
      ci.indexOf('- name: Build standalone and backup images'),
      ci.indexOf('- name: Native Argon2 and PostgreSQL migration smoke'),
    );
    expect(composeBuildStep).toContain('ADMIN_EMAIL: ops@example.test');
    expect(composeBuildStep).toContain('docker build -t doupu-app:local .');
    expect(composeBuildStep).toContain('docker compose -f docker-compose.prod.yml build backup');
    const verifyRelease = read('deploy/scripts/verify-release.sh');
    expect(verifyRelease).toContain('deploy/evidence/mobile/v${VERSION}.json');
    expect(verifyRelease).toContain('evidence.candidateCommit === candidateCommit');
    expect(verifyRelease).toContain('attestation commit must have exactly one parent');
    expect(verifyRelease).toContain('attestation commit may change only');
    expect(verifyRelease).toContain('evidence.ios?.browser === "Safari"');
    expect(verifyRelease).toContain('evidence.android?.browser === "Chrome"');
    expect(verifyRelease).toContain('deploy/evidence/algorithm/v${VERSION}.json');
    expect(verifyRelease).toContain('"transparent-antialias"');
    expect(verifyRelease).toContain('evidence.passed === true');
  });

  shellIt('accepts a constructible evidence-only attestation commit and rejects unrelated changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'doupu-release-attestation-'));
    ensureDirs(join(root, 'deploy', 'scripts'), join(root, 'deploy', 'evidence', 'mobile'), join(root, 'deploy', 'evidence', 'algorithm'), join(root, 'src', 'lib'));
    copyFileSync('deploy/scripts/verify-release.sh', join(root, 'deploy', 'scripts', 'verify-release.sh'));
    writeFileSync(join(root, 'package.json'), '{"version":"0.2.0"}\n');
    writeFileSync(join(root, 'src', 'lib', 'appInfo.ts'), "export const APP_VERSION = '0.2.0';\n");
    writeFileSync(join(root, 'CHANGELOG.md'), '## [0.2.0]\n');
    const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    expect(git('init', '-q').status).toBe(0);
    expect(git('config', 'user.name', 'Release Test').status).toBe(0);
    expect(git('config', 'user.email', 'release@example.test').status).toBe(0);
    expect(git('add', '.').status).toBe(0);
    expect(git('commit', '-qm', 'candidate').status).toBe(0);
    const candidateCommit = git('rev-parse', 'HEAD').stdout.trim();
    const evidence = (candidate: string) => ({
      version: '0.2.0', candidateCommit: candidate, completedAt: '2026-08-17T08:00:00.000Z', tester: 'Human Tester',
    });
    writeFileSync(join(root, 'deploy', 'evidence', 'mobile', 'v0.2.0.json'), JSON.stringify({
      ...evidence(candidateCommit),
      ios: { device: 'iPhone', os: 'iOS', browser: 'Safari', passed: true },
      android: { device: 'Pixel', os: 'Android', browser: 'Chrome', passed: true },
    }));
    writeFileSync(join(root, 'deploy', 'evidence', 'algorithm', 'v0.2.0.json'), JSON.stringify({
      ...evidence(candidateCommit), passed: true,
      fixtures: ['photo', 'pixel-art', 'skin-gradient', 'edge-subject', 'transparent-antialias', 'real-heic'],
    }));
    expect(git('add', '.').status).toBe(0);
    expect(git('commit', '-qm', 'release evidence').status).toBe(0);
    const attestationCommit = git('rev-parse', 'HEAD').stdout.trim();
    const accepted = spawnSync('sh', ['deploy/scripts/verify-release.sh', '0.2.0'], {
      cwd: root,
      env: { ...process.env, GITHUB_SHA: attestationCommit },
      encoding: 'utf8',
    });
    expect(accepted.status, accepted.stderr).toBe(0);

    writeFileSync(join(root, 'UNRELATED.md'), 'must reject\n');
    for (const kind of ['mobile', 'algorithm']) {
      const path = join(root, 'deploy', 'evidence', kind, 'v0.2.0.json');
      const body = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      writeFileSync(path, JSON.stringify({ ...body, candidateCommit: attestationCommit }));
    }
    expect(git('add', '.').status).toBe(0);
    expect(git('commit', '-qm', 'invalid attestation').status).toBe(0);
    const invalidCommit = git('rev-parse', 'HEAD').stdout.trim();
    const rejected = spawnSync('sh', ['deploy/scripts/verify-release.sh', '0.2.0'], {
      cwd: root,
      env: { ...process.env, GITHUB_SHA: invalidCommit },
      encoding: 'utf8',
    });
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('attestation commit may change only');
  });

  it('executes the PostgreSQL 16 contract through real design and palette routes', () => {
    const ci = read('.github/workflows/ci.yml');
    const contract = read('tests/postgres/route-contract.cjs');
    expect(ci).toContain('node tests/postgres/route-contract.cjs');
    const standaloneStart = ci.indexOf('docker run -d --name doupu-standalone-ci');
    const routeContract = ci.indexOf('node tests/postgres/route-contract.cjs');
    const browserContract = ci.indexOf('npm run test:e2e:production');
    expect(routeContract).toBeGreaterThan(standaloneStart);
    expect(browserContract).toBeGreaterThan(routeContract);
    expect(contract).toContain('/api/designs/');
    expect(contract).toContain('/api/palettes/');
    expect(contract).toContain('palette route CAS did not produce exactly one winner');
    expect(contract).toContain('design byte quota race did not produce exactly one winner');
    expect(contract).toContain('design byte quota was exceeded');
    expect(contract).toContain('cursor pagination returned duplicate designs');
    expect(contract).toContain('cursor pagination missed a persisted design');
    expect(contract).toContain('lost-response retry was not classified as an already-committed write');
    expect(contract).toContain('lost-response retry created duplicate rows');
    expect(contract).toContain('Promise.all');
    expect(contract).toContain('REVISION_CONFLICT');
    expect(contract).toContain('design active quota');
    expect(contract).toContain("request('DELETE'");
    expect(contract).toContain('tombstone retained payload');
    const testingAdr = read('docs/adr/0006-testing-strategy.md');
    expect(testingAdr).toContain('不声称三层复用同一个客户端 adapter contract');
    expect(testingAdr).toContain('解析产物 `Tm` 绘制坐标');
    expect(testingAdr).not.toContain('尚未解析生成 PDF 的实际文本绘制坐标');
    expect(testingAdr).not.toContain('Fake/PGlite/PostgreSQL 16 已共享 revision/CAS');
  });

  it('defines the required consecutive quality runs without retries', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['test:coverage:stable']).toBe('node tests/ci/repeat.cjs 5 npm run test:coverage');
    expect(pkg.scripts['test:performance:stable']).toBe('node tests/ci/repeat.cjs 5 npm run test:performance');
    expect(pkg.scripts['test:e2e:stable']).toBe('node tests/ci/repeat.cjs 3 npm run test:e2e');
    expect(read('playwright.config.mts')).toMatch(/retries:\s*0/);
  });

  it('keeps shared-state E2E serial and retains a trace on the first failure', () => {
    const config = read('playwright.config.mts');
    expect(config).toMatch(/workers:\s*1/);
    expect(config).toMatch(/retries:\s*0/);
    expect(config).toContain("trace: 'retain-on-failure'");
  });

  it('runs a real Chromium workflow against the standalone production image', () => {
    const ci = read('.github/workflows/ci.yml');
    const config = read('playwright.production.config.mts');
    const spec = read('tests/e2e/08-production-runtime.spec.ts');
    expect(ci).toContain('npm run test:e2e:production');
    expect(config).not.toContain('globalSetup');
    expect(config).toContain('08-production-runtime.spec.ts');
    expect(spec).toContain("crossOriginIsolated");
    expect(spec).toContain("content-security-policy");
    expect(spec).toContain("图片文件选择器");
    expect(spec).toContain("baseRevision");
    expect(spec).toContain("verify-email");
    expect(ci).toContain('E2E_SESSION_TOKEN');
    expect(ci).toContain('E2E_VERIFY_TOKEN');
  });

  it('restores the latest promoted production COS backup on a monthly schedule', () => {
    const workflow = read('.github/workflows/production-backup-restore.yml');
    expect(workflow).toContain('cron: "23 4 1 * *"');
    expect(workflow).toContain('doupucos:${COS_BUCKET}/doupu-backup');
    expect(workflow).toContain('rclone copyto');
    expect(workflow).toContain('--max-age 36h');
    expect(workflow).toContain('/scripts/restore-drill.sh');
    expect(workflow).toContain('postgres:16-alpine');
    expect(workflow).toContain('RESTORE_CANARY_SQL=SELECT count(*) FROM users');
  });
});
