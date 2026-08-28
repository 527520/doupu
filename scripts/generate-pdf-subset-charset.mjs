/**
 * 生成 src/lib/export/pdfSubsetCharset.json —— PDF 中文子集字体的字符集（A-04）。
 *
 * 为什么是生成的 JSON：构建脚本（node，纯 JS）与运行时（TypeScript/浏览器）必须使用
 * 完全相同的字符集，否则会出现「子集里没有这个字，运行时却以为有」的掉字缺陷。
 * JSON 是两边都能直接读的唯一产物，避免两处各写一份定义。
 *
 * 常用汉字来源：GB2312 汉字区（一级 0xB0A1–0xD7F9 的 3755 常用字 + 二级 0xD8A1–0xF7FE 的
 * 3008 次常用字，合计 6763），用 Node 的 TextDecoder('gbk') 枚举得到，不引入数据文件或第三方依赖。
 *
 * 重新生成：node scripts/generate-pdf-subset-charset.mjs（产物已提交，平时无需重跑）
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** PDF 版式里固定出现的文本：页眉、图例、总计、单位等。 */
const STATIC_TEXT = '第页共列行图例总计粒色号数量豆谱图纸未命名设计板块';

/** 拉丁字母、数字与 ASCII 标点（色号形如 C-01、A12）。 */
const ASCII_PRINTABLE = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('');

/** 全角与中文排版常用符号（含 PDF 页眉用的 en dash U+2013）。 */
const CJK_PUNCTUATION = '　！？。，、；：“”‘’（）《》〈〉【】〔〕…—–～·％＃＆＊＋－／＝｜×';

const decoder = new TextDecoder('gbk');
const common = [];
// GB2312 汉字区：一级 0xB0A1–0xD7F9（3755 常用字，按拼音）+ 二级 0xD8A1–0xF7FE（3008 次常用字）。
// 只收一级是不够的：「草莓」的「莓」就在二级区，而这类字在设计名里很常见。
for (let high = 0xb0; high <= 0xf7; high++) {
  for (let low = 0xa1; low <= 0xfe; low++) {
    const decoded = decoder.decode(new Uint8Array([high, low]));
    const codePoint = decoded.length === 1 ? decoded.codePointAt(0) : undefined;
    // 只收 CJK 统一汉字：GBK 表里有少量未分配槽位会解到私用区（U+E810 起），
    // 那些码位在 Noto 里没有字形，收进来会让「子集覆盖」判断说谎。
    if (codePoint !== undefined && codePoint >= 0x4e00 && codePoint <= 0x9fff) common.push(decoded);
  }
}
if (common.length < 6700) throw new Error(`GB2312 汉字表异常：只解出 ${common.length} 个字`);

const chars = [...new Set([...ASCII_PRINTABLE, ...CJK_PUNCTUATION, ...STATIC_TEXT, ...common])].join('');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src', 'lib', 'export', 'pdfSubsetCharset.json');
writeFileSync(
  target,
  `${JSON.stringify({
    generatedBy: 'scripts/generate-pdf-subset-charset.mjs',
    source: 'GB2312 level-1 (0xB0A1-0xD7F9) + ASCII + CJK punctuation + PDF static text',
    count: [...chars].length,
    chars,
  }, null, 0)}\n`,
  'utf8',
);
console.log(`已生成 ${target}：${[...chars].length} 个字符（其中常用汉字 ${common.length}）`);
