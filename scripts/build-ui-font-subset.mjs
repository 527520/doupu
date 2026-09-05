/** Explicit offline regeneration; normal builds only check the committed assets.
 * Requires fonttools==4.60.1 to rename OFL derivatives before subsetting.
 * node scripts/build-ui-font-subset.mjs --python /path/to/python
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const subsetFont = require('subset-font');
const fontkit = require('@pdf-lib/fontkit');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const output = join(root, 'public/fonts/ui');
const staging = mkdtempSync(join(tmpdir(), 'doupu-renamed-fonts-'));
const pythonIndex = process.argv.indexOf('--python');
const python = pythonIndex < 0 ? 'python3' : process.argv[pythonIndex + 1];
const sources = [
  { file: 'NotoSansSC-VF.ttf', sha256: 'd68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964', name: 'DouPu Text', stem: 'text', weight: '100 900', license: 'NotoSans-LICENSE.txt' },
  { file: 'ChillRoundF.ttf', sha256: '7dae804b344f7bc1a1c8426b9515e9b54d7baac3e123263d0bae94d0a305a732', name: 'DouPu Round', stem: 'round', weight: '400', license: 'ChillRound-LICENSE.txt' },
];
function sourceText(directory) {
  return readdirSync(directory, { withFileTypes: true }).map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceText(path) : /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? readFileSync(path, 'utf8') : '';
  }).join('\n');
}
const ui = new Set([...sourceText(join(root, 'src'))].map((char) => char.codePointAt(0)));
for (let code = 32; code <= 255; code++) ui.add(code);
const ranges = (codes) => {
  const result = [];
  for (let i = 0; i < codes.length; i++) {
    const start = codes[i];
    let end = start;
    while (codes[i + 1] === end + 1) end = codes[++i];
    result.push(`U+${start.toString(16)}${end === start ? '' : `-${end.toString(16)}`}`);
  }
  return result.join(',');
};
mkdirSync(output, { recursive: true });
const files = [];
const css = ['/* Generated offline by scripts/build-ui-font-subset.mjs. OFL derivatives; see manifest.json. */'];
for (const source of sources) {
  const input = join(root, 'assets/ui-fonts', source.file);
  if (sha(readFileSync(input)) !== source.sha256) throw new Error(`Unrecognized font source: ${source.file}`);
  const renamed = join(staging, source.file);
  const result = spawnSync(python, [join(root, 'scripts/rename-ui-font.py'), input, renamed, source.name], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Font rename failed');
  const bytes = readFileSync(renamed);
  const all = [...new Set(fontkit.create(bytes).characterSet)].filter((code) => code >= 32 && code <= 0x10ffff).sort((a, b) => a - b);
  const displayCopy = new Set([...'把喜欢，一颗颗拼出来。下一张，想拼什么？'].map((char) => char.codePointAt(0)));
  const core = all.filter((code) => source.stem === 'text' ? ui.has(code) : code < 128 || displayCopy.has(code));
  const extra = all.filter((code) => !ui.has(code));
  const chunks = [{ key: 'core', codes: core }];
  // Public titles/comments are not limited to application copy. Disjoint chunks
  // download only when their characters occur in visible content.
  if (source.stem === 'text') for (let i = 0; i < extra.length; i += 512) chunks.push({ key: `ext-${i / 512}`, codes: extra.slice(i, i + 512) });
  for (const { key, codes } of chunks) {
    const buffer = await subsetFont(bytes, String.fromCodePoint(...codes), {
      targetFormat: 'woff2', preserveNameIds: [0, 7, 8, 9, 11, 13, 14, 16, 17],
    });
    const filename = `${source.stem}-${key}.woff2`;
    const unicodeRange = ranges(codes);
    writeFileSync(join(output, filename), buffer);
    files.push({ file: filename, family: source.name, weight: source.weight, bytes: buffer.length, sha256: sha(buffer), unicodeRange });
    css.push(`@font-face{font-family:"${source.name}";font-style:normal;font-weight:${source.weight};font-display:swap;src:url("/fonts/ui/${filename}?v=${sha(buffer).slice(0, 16)}") format("woff2");unicode-range:${unicodeRange};}`);
  }
  const license = readFileSync(join(root, 'assets/ui-fonts', source.license));
  writeFileSync(join(output, source.license), license);
  files.push({ file: source.license, bytes: license.length, sha256: sha(license) });
}
const cssBytes = Buffer.from(`${css.join('\n')}\n`);
writeFileSync(join(output, 'fonts.css'), cssBytes);
files.push({ file: 'fonts.css', bytes: cssBytes.length, sha256: sha(cssBytes) });
writeFileSync(join(output, 'manifest.json'), JSON.stringify({ version: 1, sources, files }, null, 2) + '\n');
console.log(`Generated ${files.length} assets; core ${files.filter((f) => /core/.test(f.file)).map((f) => `${f.file} ${(f.bytes / 1024).toFixed(0)} KiB`).join(', ')}. Staging: ${staging}`);
