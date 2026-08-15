// 测试 fixture 生成器（零依赖，node 直接运行）：node tests/fixtures/generate.mjs
// 说明：这些是「字节级合成」的 fixture，用于 src/lib/image 的嗅探/动图检测/校验单测。
// 合成 GIF/APNG 的像素数据仅供结构解析（帧计数）使用；真实解码断言由 E2E（ticket 20）
// 用 Playwright 生成的截图/真实样本覆盖。运行后产物提交到仓库（均为小文件）。
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = dirname(fileURLToPath(import.meta.url));
mkdirSync(outDir, { recursive: true });
const write = (name, buf) => writeFileSync(join(outDir, name), buf);

// ---------- 工具 ----------

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256).map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c;
    });
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function buildPng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: None
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function fcTL(seq) {
  const d = Buffer.alloc(26);
  d.writeUInt32BE(seq, 0);
  d.writeUInt32BE(2, 4); // width
  d.writeUInt32BE(2, 8); // height
  d.writeUInt32BE(0, 12); // x
  d.writeUInt32BE(0, 16); // y
  d.writeUInt16BE(1, 20); // delay num
  d.writeUInt16BE(1, 22); // delay den
  d[24] = 0; // dispose
  d[25] = 0; // blend
  return d;
}

// ---------- PNG 系列 ----------

const pixelRow = Buffer.from([0xff, 0x00, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff]); // 红、绿
const staticPng = buildPng(2, 1, pixelRow);
write('static-2x2.png', buildPng(2, 2, Buffer.concat([pixelRow, pixelRow])));
write('static.png', staticPng);
write('truncated.png', staticPng.subarray(0, Math.floor(staticPng.length * 0.6)));

// APNG：IHDR + acTL(2帧) + fcTL0 + IDAT + fcTL1 + fdAT + IEND
{
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((2 * 4 + 1) * 2, 0);
  for (let y = 0; y < 2; y++) pixelRow.copy(raw, y * 9 + 1);
  const acTL = Buffer.alloc(8);
  acTL.writeUInt32BE(2, 0); // num_frames
  acTL.writeUInt32BE(0, 4); // num_plays
  const fdAT = Buffer.concat([Buffer.from([0, 0, 0, 1]), deflateSync(raw)]);
  const apng = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('acTL', acTL),
    chunk('fcTL', fcTL(0)),
    chunk('IDAT', deflateSync(raw)),
    chunk('fcTL', fcTL(1)),
    chunk('fdAT', fdAT),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  write('animated-2frames.png', apng);
}

// ---------- GIF 系列 ----------

function buildGif(frameCount) {
  const head = Buffer.from('GIF87a', 'ascii');
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(2, 0); // width
  lsd.writeUInt16LE(2, 2); // height
  lsd[4] = 0x91; // GCT + 2^(1+1)=4 色
  lsd[5] = 0; // bg
  lsd[6] = 0; // aspect
  const gct = Buffer.from([
    0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 255, // 黑/白/红/蓝
  ]);
  const parts = [head, lsd, gct];
  for (let f = 0; f < frameCount; f++) {
    // GCE：无透明、延迟 10
    const gce = Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00]);
    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(0, 1);
    desc.writeUInt16LE(0, 3);
    desc.writeUInt16LE(2, 5);
    desc.writeUInt16LE(2, 7);
    desc[9] = 0x00; // 无局部色表
    // LZW 子块：min code size 2 + 子块(3 字节：clear(4)+4×color0+EOI(5) 的 3-bit 打包) + 终止符
    const data = Buffer.from([0x02, 0x03, 0x80, 0x02, 0x80, 0x00]);
    parts.push(gce, desc, data);
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}
write('static.gif', buildGif(1));
write('animated-2frames.gif', buildGif(2));

// ---------- WebP 系列 ----------

function riff(chunks) {
  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), ...chunks]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), size, body]);
}
function webpChunk(type, data) {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  const padded = data.length % 2 === 1 ? Buffer.concat([data, Buffer.from([0])]) : data;
  return Buffer.concat([Buffer.from(type, 'ascii'), size, padded]);
}
// 静态：VP8L（0x2F 签名 + 最小载荷）
write('static.webp', riff([webpChunk('VP8L', Buffer.from([0x2f, 0x00, 0x00, 0x00]))]));
// 动画：VP8X 标志位 bit1（animation）置 1
{
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x02; // flags: animation
  vp8x[4] = 1; // canvas width - 1
  vp8x[7] = 1; // canvas height - 1
  write('animated.webp', riff([webpChunk('VP8X', vp8x)]));
}

// ---------- 其他 ----------

write('empty.bin', Buffer.alloc(0));
write('text-as-photo.jpg', Buffer.from('这不是图片，只是文本', 'utf8'));
// 损坏 JPEG：魔数合法（通过嗅探）但内容必然解码失败（浏览器对截断 PNG 较宽容，JPEG 更严格）
{
  const junk = Buffer.alloc(2048);
  for (let i = 0; i < junk.length; i++) junk[i] = (i * 31) % 256;
  write('corrupt.jpg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), junk]));
}
// E2E 用彩色渐变照片（64×64，覆盖多色相）
{
  const size = 64;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      pixels[i] = Math.round((x / size) * 255);
      pixels[i + 1] = Math.round((y / size) * 255);
      pixels[i + 2] = Math.round(128 + 64 * Math.sin((x + y) / 8));
      pixels[i + 3] = 255;
    }
  }
  write('photo-gradient-64.png', buildPng(size, size, pixels));
  // 全透明 PNG（E10）
  write('transparent-64.png', buildPng(size, size, Buffer.alloc(size * size * 4)));
  // 裁剪交互测试用大图（320×200：角手柄热区占比小，可区分移动/缩放/框选）
  {
    const w = 320;
    const h = 200;
    const px = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        px[i] = Math.round((x / w) * 255);
        px[i + 1] = Math.round((y / h) * 255);
        px[i + 2] = Math.round(128 + 64 * Math.sin((x + y) / 16));
        px[i + 3] = 255;
      }
    }
    write('photo-wide-320x200.png', buildPng(w, h, px));
  }
}
// 伪 HEIC：ftyp 盒（size=20, 'ftyp', major 'heic', minor 0, 兼容 'mif1'）+ 垃圾字节
{
  const ftyp = Buffer.alloc(20);
  ftyp.writeUInt32BE(20, 0);
  ftyp.write('ftyp', 4, 'ascii');
  ftyp.write('heic', 8, 'ascii');
  ftyp.write('mif1', 16, 'ascii');
  write('fake.heic', Buffer.concat([ftyp, Buffer.from([1, 2, 3, 4])]));
}

console.log('fixtures written to', outDir);
