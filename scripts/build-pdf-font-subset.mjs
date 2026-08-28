/**
 * 构建期生成 PDF 中文子集字体（A-04）。
 *
 * 输入：public/fonts/NotoSansCJKsc-Regular.otf（16.4 MB 全量字体，保留作生僻字兜底）
 * 输出：public/fonts/NotoSansCJKsc-Regular.subset.otf（常用字子集）
 *
 * 字符集读自 src/lib/export/pdfSubsetCharset.json —— 与运行时判断用的是同一份产物。
 * 由 npm run prebuild 自动执行；产物不进版本库，Docker 构建与 CI 都会重新生成。
 *
 * 子集工具：subset-font（HarfBuzz WASM）。为什么不是 @pdf-lib/fontkit 的 createSubset：
 * 它对 CFF（OTF）字体的 encodeStream 输出不是合法 sfnt（表目录损坏，连 @pdf-lib/fontkit
 * 自己都读不回），运行时对这份坏字体做 embedFont(subset:true) 会耗尽内存并挂死主线程。
 * 全量字体在 pdf-lib 里的运行时子集走的是「CFF 直嵌 PDF」路径（无 sfnt 包装），不受影响。
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'public', 'fonts', 'NotoSansCJKsc-Regular.otf');
const target = join(root, 'public', 'fonts', 'NotoSansCJKsc-Regular.subset.otf');
const charsetFile = join(root, 'src', 'lib', 'export', 'pdfSubsetCharset.json');

if (!existsSync(source)) {
  console.error(`[pdf-font] 缺少全量字体 ${source}，跳过子集生成`);
  process.exit(0);
}

const require = createRequire(import.meta.url);
const subsetFont = require('subset-font');
const { chars } = JSON.parse(readFileSync(charsetFile, 'utf8'));

const sourceBytes = readFileSync(source);
// charset JSON 的 chars 字段本身就是字符串（见 generate-pdf-subset-charset.mjs）
const bytes = await subsetFont(sourceBytes, chars, { targetFormat: 'sfnt' });
if (!bytes || bytes.length === 0) throw new Error('[pdf-font] 子集编码结果为空');
if (bytes.length >= sourceBytes.length) throw new Error('[pdf-font] 子集不小于全量字体，生成有误');

// 产物自检：必须能被运行时（@pdf-lib/fontkit + pdf-lib embedFont）解析并二次子集。
// 历史上 @pdf-lib/fontkit 的 createSubset 产物连它自己都读不回，运行时导出 PDF 会
// 耗尽内存挂死主线程——把这类坏产物在构建期就拦下来，而不是等用户导出时才发现。
const fontkit = require('@pdf-lib/fontkit');
const { PDFDocument } = require('pdf-lib');
const probe = fontkit.create(Buffer.from(bytes));
if (probe.numGlyphs < 1) throw new Error('[pdf-font] 自检失败：产物无法被 fontkit 解析');
const probeDoc = await PDFDocument.create();
probeDoc.registerFontkit(fontkit);
await probeDoc.embedFont(bytes, { subset: true });

writeFileSync(target, bytes);

const sourceSize = statSync(source).size;
console.log(
  `[pdf-font] 子集已生成并通过自检：字符集 ${chars.length} 字，`
  + `${(bytes.length / 1024 / 1024).toFixed(2)} MB / 全量 ${(sourceSize / 1024 / 1024).toFixed(2)} MB`,
);
