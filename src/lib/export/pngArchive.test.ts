import { describe, expect, it } from 'vitest';
import { createPngArchiveBlob } from './pngArchive';

interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

function readStoredEntries(buffer: ArrayBuffer): ZipEntry[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let offset = 0; offset + 46 <= bytes.length;) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      offset++;
      continue;
    }
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    expect(method).toBe(0);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, bytes: bytes.slice(dataStart, dataStart + size) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe('createPngArchiveBlob', () => {
  it('ZIP 恰好包含两张命名正确且字节不变的 PNG', async () => {
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    const patternBytes = new Uint8Array([...pngSignature, 1, 2, 3]);
    const legendBytes = new Uint8Array([...pngSignature, 4, 5, 6]);
    const blob = await createPngArchiveBlob([
      { fileName: '豆谱-测试-200x200-图纸.png', blob: new Blob([patternBytes], { type: 'image/png' }) },
      { fileName: '豆谱-测试-200x200-图例.png', blob: new Blob([legendBytes], { type: 'image/png' }) },
    ]);

    expect(blob.type).toBe('application/zip');
    const entries = readStoredEntries(await blob.arrayBuffer());
    expect(entries.map((entry) => entry.name)).toEqual([
      '豆谱-测试-200x200-图纸.png',
      '豆谱-测试-200x200-图例.png',
    ]);
    expect(Array.from(entries[0].bytes)).toEqual(Array.from(patternBytes));
    expect(Array.from(entries[1].bytes)).toEqual(Array.from(legendBytes));
  });
});
