#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const sourcePath = resolve(repositoryRoot, 'src/lib/palettes/data/colorSystemMapping.json');
const outputDirectory = resolve(repositoryRoot, 'src/lib/palettes/data/legacy');

const PALETTES = [
  ['MARD', 'mard.generated.json'],
  ['COCO', 'coco.generated.json'],
  ['漫漫', 'manman.generated.json'],
  ['盼盼', 'panpan.generated.json'],
  ['咪小窝', 'mixiaowo.generated.json'],
];

function normalizeCode(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized === '' || normalized === '-' ? null : normalized;
}

function main() {
  const checkOnly = process.argv.slice(2).includes('--check');
  const sourceBytes = readFileSync(sourcePath);
  const source = JSON.parse(sourceBytes.toString('utf8'));
  const entries = Object.entries(source);
  if (entries.length !== 291) {
    throw new Error(`旧色板矩阵应有 291 行，实际 ${entries.length}`);
  }

  const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
  const artifacts = [];

  for (const [brand, filename] of PALETTES) {
    const colors = entries.map(([hex, codes], index) => {
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
        throw new Error(`${brand} 第 ${index + 1} 行 HEX 非法: ${hex}`);
      }
      if (typeof codes[brand] !== 'string') {
        throw new Error(`${brand} 第 ${index + 1} 行缺少色号值`);
      }
      return { code: normalizeCode(codes[brand]), hex };
    });
    const unavailableCode = colors.filter((color) => color.code === null).length;

    const output = {
      schema: 'doupu-legacy-builtin-palette-v1',
      id: brand,
      source: {
        repository: 'https://github.com/Zippland/perler-beads',
        path: 'src/app/colorSystemMapping.json',
        license: 'AGPL-3.0',
        sourceSha256,
        versionId: `zippland-291-v1/${brand}`,
      },
      analysis: {
        engineColorCount: colors.length - unavailableCode,
        exclusions: {
          total: unavailableCode,
          unavailableCode,
          transparent: 0,
          unidentified: 0,
          duplicateHex: 0,
        },
      },
      colors,
    };
    artifacts.push({ path: resolve(outputDirectory, filename), contents: `${JSON.stringify(output)}\n` });
  }

  if (checkOnly) {
    const mismatches = artifacts.filter(({ path, contents }) => {
      try {
        return readFileSync(path, 'utf8') !== contents;
      } catch {
        return true;
      }
    });
    if (mismatches.length > 0) {
      throw new Error(`旧色板生成产物不一致：${mismatches.map(({ path }) => path).join('、')}`);
    }
    console.log('旧色板生成产物与固定矩阵一致');
    return;
  }

  mkdirSync(outputDirectory, { recursive: true });
  for (const artifact of artifacts) writeFileSync(artifact.path, artifact.contents);
  console.log(`已从旧矩阵生成 ${PALETTES.length} 个独立紧凑色板文件`);
}

main();
