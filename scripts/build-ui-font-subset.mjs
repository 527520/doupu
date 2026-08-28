/**
 * 构建期生成界面中文字体子集（C-8）。
 *
 * 背景：Android 没有内置圆体/圆润中文字体，字体栈会一路回退到系统黑体，
 * 安卓用户看到的界面与 iOS/Windows 差别明显。自托管一份字体可以统一观感，
 * 但整份中文字体有 8 MB 级别，不能直接当 web font 发。
 *
 * 做法：只取「界面上真正会出现的字」——src/messages/zh-CN.ts 里的全部文案
 * （约 728 个字符）+ ASCII + 常用标点，子集后约 130 KB。
 * 用户输入的设计名若含子集外的字，浏览器会按字回退到系统字体（可接受：
 * 设计名主要出现在输入框里；把 GB2312 全字收进来会涨到 1.6 MB，不值）。
 *
 * 子集工具：subset-font（HarfBuzz WASM）。此前用 @pdf-lib/fontkit 的 createSubset，
 * 产物虽然能被 Chromium/WebKit 渲染，但 Firefox 的字体消毒器拒绝加载
 * （"hhea: misaligned table"），控制台报错直接拉红 350/390px 移动端门禁。
 *
 * 源字体放在 assets/fonts/（不入库、不对外提供），产物 public/fonts/ui-sans-sc.subset.ttf
 * 也不入库，由 npm run prebuild 生成。没有源字体时静默跳过——@font-face 会失效，
 * 字体栈自动回退，不影响构建与渲染。
 *
 * 换字体只需把新的 ttf/otf 放进 assets/fonts/ 并删掉旧的，无需改代码。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'assets', 'fonts');
const target = join(root, 'public', 'fonts', 'ui-sans-sc.subset.ttf');

if (!existsSync(sourceDir)) {
  console.log('[ui-font] 未提供 assets/fonts 源字体，跳过界面字体子集');
  process.exit(0);
}
const candidates = readdirSync(sourceDir).filter((name) => /\.(ttf|otf)$/i.test(name));
if (candidates.length === 0) {
  console.log('[ui-font] assets/fonts 下没有 ttf/otf，跳过界面字体子集');
  process.exit(0);
}
if (candidates.length > 1) {
  console.warn(`[ui-font] assets/fonts 下有多个字体（${candidates.join(', ')}），取第一个：${candidates[0]}`);
}

/** 界面字符集：文案里的中日韩字与全角标点 + ASCII 可打印区。 */
function uiCharset() {
  const messages = readFileSync(join(root, 'src', 'messages', 'zh-CN.ts'), 'utf8');
  const charset = new Set();
  for (const char of messages) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2010-\u203a]/.test(char)) charset.add(char);
  }
  for (let code = 0x20; code <= 0x7e; code++) charset.add(String.fromCharCode(code));
  return charset;
}

const require = createRequire(import.meta.url);
const subsetFont = require('subset-font');
const fontkit = require('@pdf-lib/fontkit');

const sourcePath = join(sourceDir, candidates[0]);
const sourceBytes = readFileSync(sourcePath);
const chars = [...uiCharset()].join('');
const bytes = await subsetFont(sourceBytes, chars, { targetFormat: 'sfnt' });
if (!bytes || bytes.length === 0) throw new Error('[ui-font] 子集编码结果为空');

// 产物自检：至少能被 fontkit 解析（完整浏览器兼容性由 E2E Firefox 门禁把关）。
const probe = fontkit.create(Buffer.from(bytes));
if (probe.numGlyphs < 1) throw new Error('[ui-font] 自检失败：产物无法被 fontkit 解析');

writeFileSync(target, bytes);
console.log(
  `[ui-font] ${candidates[0]} → ${chars.length} 字形，${(bytes.length / 1024).toFixed(0)} KB`
  + `（源 ${(sourceBytes.length / 1024 / 1024).toFixed(2)} MB）`,
);
