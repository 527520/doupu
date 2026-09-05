/** Build/deployment gate: no network, Python, generation or optional fallback. */
const { readFileSync } = require('node:fs');
const { resolve, join, basename } = require('node:path');
const { createHash } = require('node:crypto');
const fontkit = require('@pdf-lib/fontkit');

try {
  const directory = process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, '../public/fonts/ui');
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length < 5) throw new Error('Invalid UI font manifest');
  for (const file of manifest.files) {
    if (basename(file.file) !== file.file) throw new Error('Invalid font filename');
    const bytes = readFileSync(join(directory, file.file));
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`UI font checksum mismatch: ${file.file}`);
    if (file.file.endsWith('.woff2')) {
      if (bytes.toString('ascii', 0, 4) !== 'wOF2') throw new Error(`Invalid WOFF2: ${file.file}`);
      const font = fontkit.create(bytes);
      if (font.familyName !== file.family || font.numGlyphs < 2) throw new Error(`Invalid font metadata: ${file.file}`);
    }
  }
  for (const core of ['text-core.woff2', 'round-core.woff2', 'NotoSans-LICENSE.txt', 'ChillRound-LICENSE.txt', 'fonts.css']) {
    if (!manifest.files.some((file) => file.file === core)) throw new Error(`Missing required font asset: ${core}`);
  }
  console.log(`UI fonts verified: ${manifest.files.length} files, offline checksums and metadata OK`);
} catch (error) {
  console.error(`[ui-font] ${error.message}`);
  process.exitCode = 1;
}
