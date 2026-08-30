#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_REPOSITORY = 'https://github.com/HansBug/pindou-color-data';
const SOURCE_REVISION = '178dafbc9e77d3de556550dbd058270200129186';
const SELECTED_PALETTES = [
  ['mard-291-github', 291],
  ['coco-291', 291],
  ['manman-278', 278],
  ['panpan-289', 289],
  ['mixiaowo-290', 290],
  ['mard-221-alfonse-doudou', 221],
  ['artkal-c-197-official', 197],
  ['artkal-m-221-official', 221],
];
const EXPECTED_SOURCE_SHA256 = Object.freeze({
  'manifest.json': '913360c7ac88f943cc8d058f7d1a0f66020b0004404729a6f9765d79dbc087de',
  LICENSE: '7ce773e89d6ae09c6c6ea0d2ec202648f57f25a259634039aea3f57f9895e97e',
  'mard-291-github/colors.json':
    'baa8e0a4a414cb45dfb62859ac2a4a8ec23a887498fdf8405d2ec96c90148455',
  'coco-291/colors.json':
    '46336ae0b4bd267041f49d339c459edc938af33b2370846c0245dff7e0b504a0',
  'manman-278/colors.json':
    'cfa0823b2114e196c90f2a54d428a7af5354634cad2ccb390a873ba6b9ffce71',
  'panpan-289/colors.json':
    '853168b6a78527fffeeb58d1dc4fab79c999c2a029c92dd05b9167898f43c105',
  'mixiaowo-290/colors.json':
    '1a6c19b8a0e433f98fd1ddbafede344b96469ecb15153bcba388ea06cc4ffbe0',
  'mard-221-alfonse-doudou/colors.json':
    '556a7e0098c0055bde47f78d430cc7d36cb3788c235f0238e6a610f64a46b0bf',
  'artkal-c-197-official/colors.json':
    '8a5dbc16187a73e3266718d24d7c95da5a38437567e93e021ab3eb778a704a61',
  'artkal-m-221-official/colors.json':
    '82a6f68b121741b2721ea0f7b1e2a5bcc03aa64c2d2e50d755d17a4a6700c17b',
});
const EXPECTED_DUPLICATE_HEX_PRIMARIES = Object.freeze({
  'mard-291-github': [],
  'coco-291': [
    { hex: '#FFFDF7', primaryCode: 'A03', duplicateCodes: ['A11'] },
    { hex: '#FFFFFF', primaryCode: 'A01', duplicateCodes: ['L14'] },
  ],
  'manman-278': [{ hex: '#D093BC', primaryCode: 'S8', duplicateCodes: ['S9'] }],
  'panpan-289': [],
  'mixiaowo-290': [],
  'mard-221-alfonse-doudou': [],
  'artkal-c-197-official': [],
  'artkal-m-221-official': [],
});

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = dirname(scriptPath);
const repositoryRoot = resolve(scriptDirectory, '..');
const generatedDataPath = resolve(
  repositoryRoot,
  'src/lib/palettes/data/pindou-color-data.generated.json',
);
const attributionDirectory = resolve(repositoryRoot, 'third_party/pindou-color-data');
const licensePath = resolve(attributionDirectory, 'LICENSE');
const sourceReadmePath = resolve(attributionDirectory, 'README.md');

function fail(message) {
  throw new Error(`[import-pindou-color-data] ${message}`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseSourceArgument(argv) {
  const sourceIndex = argv.indexOf('--source');
  if (sourceIndex === -1 || !argv[sourceIndex + 1]) {
    fail(
      `缺少 --source。先检出 ${SOURCE_REPOSITORY} 的 ${SOURCE_REVISION}，` +
        '再传入其本地目录。',
    );
  }
  return resolve(argv[sourceIndex + 1]);
}

function isCheckMode(argv) {
  return argv.includes('--check');
}

export function analyzeEngineColors(colors) {
  const seenHexes = new Set();
  const primaryCodeByHex = new Map();
  const duplicateGroupByHex = new Map();
  const duplicateHexPrimaries = [];
  const exclusions = {
    total: 0,
    unavailableCode: 0,
    transparent: 0,
    unidentified: 0,
    duplicateHex: 0,
  };

  for (const color of colors) {
    const normalizedHex = color.hex.toUpperCase();
    const normalizedCode = typeof color.code === 'string' ? color.code.trim() : '';
    if (normalizedCode === '') {
      exclusions.unavailableCode += 1;
    } else if (color.transparency !== undefined || /^#[0-9A-F]{8}$/.test(normalizedHex)) {
      exclusions.transparent += 1;
    } else if (
      color.unidentified === true ||
      /^UNKNOWN(?:[-_]|$)/i.test(normalizedCode) ||
      normalizedCode === '?'
    ) {
      exclusions.unidentified += 1;
    } else if (seenHexes.has(normalizedHex)) {
      exclusions.duplicateHex += 1;
      let group = duplicateGroupByHex.get(normalizedHex);
      if (!group) {
        group = {
          hex: normalizedHex,
          primaryCode: primaryCodeByHex.get(normalizedHex),
          duplicateCodes: [],
        };
        duplicateGroupByHex.set(normalizedHex, group);
        duplicateHexPrimaries.push(group);
      }
      group.duplicateCodes.push(normalizedCode);
    } else {
      seenHexes.add(normalizedHex);
      primaryCodeByHex.set(normalizedHex, normalizedCode);
    }
  }

  exclusions.total =
    exclusions.unavailableCode +
    exclusions.transparent +
    exclusions.unidentified +
    exclusions.duplicateHex;
  return { engineColorCount: seenHexes.size, exclusions, duplicateHexPrimaries };
}

function verifyRepository(sourceDirectory) {
  let revision;
  try {
    revision = execFileSync('git', ['-C', sourceDirectory, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    fail(`${sourceDirectory} 不是可读取的 git checkout`);
  }

  if (revision !== SOURCE_REVISION) {
    fail(`上游 revision 必须是 ${SOURCE_REVISION}，实际为 ${revision}`);
  }

  const selectedPaths = Object.keys(EXPECTED_SOURCE_SHA256);
  const status = execFileSync(
    'git',
    ['-C', sourceDirectory, 'status', '--porcelain', '--untracked-files=no', '--', ...selectedPaths],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  if (status !== '') {
    fail(`上游选定文件存在未提交修改：${status.replaceAll('\n', ', ')}`);
  }
}

function readPinnedSourceFile(sourceDirectory, sourcePath) {
  const expectedHash = EXPECTED_SOURCE_SHA256[sourcePath];
  if (!expectedHash) fail(`没有为上游文件锁定 SHA-256：${sourcePath}`);

  let bytes;
  try {
    bytes = execFileSync(
      'git',
      ['-C', sourceDirectory, 'show', `${SOURCE_REVISION}:${sourcePath}`],
      { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 },
    );
  } catch {
    fail(`无法从固定 commit 读取上游文件：${sourcePath}`);
  }
  const actualHash = sha256(bytes);
  if (actualHash !== expectedHash) {
    fail(`${sourcePath} SHA-256 不匹配：预期 ${expectedHash}，实际 ${actualHash}`);
  }
  return bytes;
}

export function verifyPalette(palette, expectedId, expectedCount, manifestEntry) {
  if (palette.schema !== 'pindou-color-palette') {
    fail(`${expectedId} schema 非 pindou-color-palette`);
  }
  if (palette.id !== expectedId) fail(`${expectedId} 的内部 id 为 ${palette.id}`);
  if (palette.count !== expectedCount || palette.colors?.length !== expectedCount) {
    fail(`${expectedId} 应有 ${expectedCount} 色，实际 ${palette.colors?.length ?? '无 colors'}`);
  }
  if (manifestEntry?.count !== expectedCount || manifestEntry?.path !== expectedId) {
    fail(`${expectedId} 与 manifest.json 不一致`);
  }

  if (!Array.isArray(palette.sources) || palette.sources.length === 0) {
    fail(`${expectedId} 缺少来源 references`);
  }
  const sourceIds = new Set();
  for (const [sourceIndex, source] of palette.sources.entries()) {
    if (typeof source.id !== 'string' || source.id.trim() === '' || sourceIds.has(source.id)) {
      fail(`${expectedId} 第 ${sourceIndex + 1} 个来源 id 非法或重复`);
    }
    sourceIds.add(source.id);
    const urls = typeof source.url === 'string' ? source.url.split(/\s*;\s*/).filter(Boolean) : [];
    if (
      urls.length === 0 ||
      urls.some((url) => {
        try {
          const parsed = new URL(url);
          return parsed.protocol !== 'https:' && parsed.protocol !== 'http:';
        } catch {
          return true;
        }
      })
    ) {
      fail(`${expectedId} 来源 ${source.id} 的 URL 非法`);
    }
    if (typeof source.quality !== 'string' || source.quality.trim() === '') {
      fail(`${expectedId} 来源 ${source.id} 缺少 quality`);
    }
    if (typeof source.notes !== 'string' || source.notes.trim() === '') {
      fail(`${expectedId} 来源 ${source.id} 缺少 notes`);
    }
  }

  const seenCodes = new Set();
  let unidentifiedCount = 0;
  for (const [index, color] of palette.colors.entries()) {
    if (typeof color.code !== 'string' || color.code.trim() === '') {
      fail(`${expectedId} 第 ${index + 1} 色缺少 code`);
    }
    if (seenCodes.has(color.code)) fail(`${expectedId} 色号重复: ${color.code}`);
    seenCodes.add(color.code);
    const hasUnknownCode = /^UNKNOWN-\d{2}$/.test(color.code);
    const isUnidentified = color.unidentified === true;
    if (hasUnknownCode !== isUnidentified) {
      fail(`${expectedId} ${color.code} 的 UNKNOWN 色号与未知标记不一致`);
    }
    if (isUnidentified) {
      unidentifiedCount += 1;
      if (color.original_code !== '-') {
        fail(`${expectedId} ${color.code} 的 original_code 必须保留为 "-"`);
      }
    }
    if (typeof color.source !== 'string' || !sourceIds.has(color.source)) {
      fail(`${expectedId} ${color.code} 引用了未声明来源: ${color.source}`);
    }

    if (!/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(color.hex)) {
      fail(`${expectedId} ${color.code} 的 HEX 非法: ${color.hex}`);
    }
    if (!Array.isArray(color.rgb) || ![3, 4].includes(color.rgb.length)) {
      fail(`${expectedId} ${color.code} 的 RGB 非法`);
    }
    if (color.rgb.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
      fail(`${expectedId} ${color.code} 的 RGB 通道越界`);
    }
    const channelsFromHex = color.hex
      .slice(1)
      .match(/.{2}/g)
      .map((channel) => Number.parseInt(channel, 16));
    if (
      channelsFromHex.length !== color.rgb.length ||
      channelsFromHex.some((channel, channelIndex) => channel !== color.rgb[channelIndex])
    ) {
      fail(`${expectedId} ${color.code} 的 HEX 与 RGB(A) 通道不一致`);
    }
  }
  if (
    !Number.isInteger(manifestEntry?.unidentified_count) ||
    manifestEntry.unidentified_count !== unidentifiedCount
  ) {
    fail(
      `${expectedId} 未知项计数与 manifest 不一致：数据 ${unidentifiedCount}，` +
        `manifest ${manifestEntry?.unidentified_count ?? '缺失'}`,
    );
  }

  const expectedDuplicatePrimaries = EXPECTED_DUPLICATE_HEX_PRIMARIES[expectedId];
  if (expectedDuplicatePrimaries) {
    const actualDuplicatePrimaries = analyzeEngineColors(palette.colors).duplicateHexPrimaries;
    if (JSON.stringify(actualDuplicatePrimaries) !== JSON.stringify(expectedDuplicatePrimaries)) {
      fail(`${expectedId} 重复 HEX 的首项语义与锁定值不一致`);
    }
  }
}

function writeOrCheckArtifacts(artifacts, checkOnly) {
  if (checkOnly) {
    const mismatches = [];
    for (const artifact of artifacts) {
      let current;
      try {
        current = readFileSync(artifact.path);
      } catch {
        mismatches.push(`${artifact.path}（缺失）`);
        continue;
      }
      const expected = Buffer.isBuffer(artifact.contents)
        ? artifact.contents
        : Buffer.from(artifact.contents);
      if (!current.equals(expected)) mismatches.push(artifact.path);
    }
    if (mismatches.length > 0) {
      fail(`生成产物与固定上游不一致：${mismatches.join('、')}`);
    }
    return;
  }

  for (const artifact of artifacts) {
    mkdirSync(dirname(artifact.path), { recursive: true });
    writeFileSync(artifact.path, artifact.contents);
  }
}

function buildSourceReadme(manifestHash, licenseHash, paletteFiles) {
  const rows = paletteFiles
    .map(
      ({ id, sourceSha256 }) =>
        `| \`${id}\` | \`${id}/colors.json\` | \`${sourceSha256}\` |`,
    )
    .join('\n');

  return `# Vendored pindou-color-data\n\n` +
    `- 上游：${SOURCE_REPOSITORY}\n` +
    `- 固定 commit：\`${SOURCE_REVISION}\`\n` +
    '- 许可证：MIT（见本目录 `LICENSE`）\n' +
    `- 上游 \`manifest.json\` SHA-256：\`${manifestHash}\`\n` +
    `- 上游 \`LICENSE\` SHA-256：\`${licenseHash}\`\n\n` +
    '本目录不使用 git submodule。应用所需的八套数据由显式脚本生成到 ' +
    '`src/lib/palettes/data/pindou-color-data.generated.json`，生产运行时不会访问网络。\n\n' +
    `应用持久化 ID 使用 \`pcd:<上游ID>@${SOURCE_REVISION}\`；下表只列上游源 ID。\n\n` +
    '重新导入：\n\n' +
    '```bash\n' +
    `git -C /path/to/pindou-color-data checkout ${SOURCE_REVISION}\n` +
    'node scripts/import-pindou-color-data.mjs --source /path/to/pindou-color-data\n' +
    'node scripts/import-pindou-color-data.mjs --source /path/to/pindou-color-data --check\n' +
    '```\n\n' +
    '导入器只读取固定 commit 的文件内容，同时核对独立锁定的 SHA-256；' +
    '选定文件有未提交修改时拒绝执行。`--check` 只比较生成产物，不重写文件。\n\n' +
    '| 内置 ID | 上游文件 | SHA-256 |\n' +
    '| --- | --- | --- |\n' +
    `${rows}\n\n` +
    '未导入的上游系列：`mard-221-github`（291 色版的子集）、' +
    '`artkal-c197-m221-418-official`（C/M 合并表）、`youken-public-174`（旧表）。\n';
}

function createRuntimePaletteData(data) {
  return {
    count: data.count,
    market: {
      tier: data.market.tier,
      score: data.market.score,
      label: data.market.label,
      summary: data.market.summary,
    },
    sources: data.sources.map(({ id, url, quality, notes }) => ({ id, url, quality, notes })),
    colors: data.colors.map(
      ({
        code,
        hex,
        group,
        source,
        notes,
        unidentified,
        original_code: originalCode,
        transparency,
      }) => ({
        code,
        hex,
        group,
        source,
        ...(notes === undefined ? {} : { notes }),
        ...(unidentified === undefined ? {} : { unidentified }),
        ...(originalCode === undefined ? {} : { original_code: originalCode }),
        ...(transparency === undefined ? {} : { transparency }),
      }),
    ),
  };
}

function main() {
  const args = process.argv.slice(2);
  const sourceDirectory = parseSourceArgument(args);
  const checkOnly = isCheckMode(args);
  verifyRepository(sourceDirectory);

  const manifestBytes = readPinnedSourceFile(sourceDirectory, 'manifest.json');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const manifestById = new Map(manifest.map((entry) => [entry.id, entry]));
  const paletteFiles = SELECTED_PALETTES.map(([id, expectedCount]) => {
    const sourcePath = `${id}/colors.json`;
    const sourceBytes = readPinnedSourceFile(sourceDirectory, sourcePath);
    const data = JSON.parse(sourceBytes.toString('utf8'));
    verifyPalette(data, id, expectedCount, manifestById.get(id));
    const { engineColorCount, exclusions } = analyzeEngineColors(data.colors);
    return {
      id,
      sourcePath,
      sourceSha256: sha256(sourceBytes),
      analysis: { engineColorCount, exclusions },
      data: createRuntimePaletteData(data),
    };
  });

  const licenseBytes = readPinnedSourceFile(sourceDirectory, 'LICENSE');
  const generated = {
    schema: 'doupu-vendored-pindou-color-data-v1',
    source: {
      repository: SOURCE_REPOSITORY,
      revision: SOURCE_REVISION,
      license: 'MIT',
      manifestSha256: sha256(manifestBytes),
      licenseSha256: sha256(licenseBytes),
    },
    palettes: paletteFiles,
  };

  const artifacts = [
    { path: generatedDataPath, contents: `${JSON.stringify(generated, null, 2)}\n` },
    { path: licensePath, contents: licenseBytes },
    {
      path: sourceReadmePath,
      contents: buildSourceReadme(
        generated.source.manifestSha256,
        generated.source.licenseSha256,
        paletteFiles,
      ),
    },
  ];
  writeOrCheckArtifacts(artifacts, checkOnly);

  if (checkOnly) {
    console.log('生成产物与固定上游一致');
  } else {
    console.log(`已生成 ${generatedDataPath}`);
    console.log(
      `已写入 ${paletteFiles.length} 套、${paletteFiles.reduce((sum, item) => sum + item.data.count, 0)} 色`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main();
}
