import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(repositoryRoot, '.artifacts');

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [resolve(repositoryRoot, 'deploy/scripts/check-protocol-v3.ts')],
  outfile: resolve(outputDirectory, 'check-protocol-v3.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['pg'],
  tsconfig: resolve(repositoryRoot, 'tsconfig.json'),
  legalComments: 'none',
  logLevel: 'info',
});
