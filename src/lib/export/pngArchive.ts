import type { PngArtifact } from './png';

/**
 * 仅在合并 PNG 超限时调用；动态 import 避免 client-zip 进入首屏与服务端模块图。
 * 两张已编码 PNG 原样存储，不做二次压缩，防止浪费 CPU 与额外峰值内存。
 */
export async function createPngArchiveBlob(
  artifacts: readonly [PngArtifact, PngArtifact],
): Promise<Blob> {
  const { downloadZip } = await import('client-zip');
  const lastModified = new Date(1980, 0, 1);
  const entries = artifacts.map((artifact) => ({
    name: artifact.fileName,
    input: artifact.blob,
    size: artifact.blob.size,
    lastModified,
  }));
  return downloadZip(entries, { metadata: entries }).blob();
}
