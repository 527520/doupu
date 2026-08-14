// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UploadDropzone, errorMessage } from './UploadDropzone';
import { zhCN } from '@/messages/zh-CN';
import { LIMITS } from '@/lib/appInfo';
import type { ImageErrorCode } from '@/lib/image/validation';

// vitest 以仓库根为 cwd；用绝对路径避免 import.meta.url 在不同转译链下的差异
const fixture = (name: string) => resolve(process.cwd(), 'tests/fixtures', name);
const fixtureBytes = (name: string): Uint8Array<ArrayBuffer> => Uint8Array.from(readFileSync(fixture(name)));

function makeFile(bytes: Uint8Array<ArrayBuffer>, name: string, type: string): File {
  return new File([bytes], name, { type });
}

/** 触发 input 的 change 事件（模拟选择文件）。 */
function selectFiles(files: File[]) {
  const input = screen.getByLabelText(zhCN.upload.inputLabel);
  fireEvent.change(input, { target: { files } });
}

describe('UploadDropzone', () => {
  it('渲染落点与隐藏 input（含 accept 列表）', () => {
    render(<UploadDropzone onValid={vi.fn()} />);
    expect(screen.getByText(zhCN.upload.hint)).toBeTruthy();
    const input = screen.getByLabelText(zhCN.upload.inputLabel) as HTMLInputElement;
    expect(input.accept).toBe('image/jpeg,image/png,image/webp,image/heic');
    // 非 mobile 模式下 React 不渲染 capture 属性
    expect(input.capture).toBeUndefined();
  });

  it('mobile 模式附加 capture 属性', () => {
    render(<UploadDropzone onValid={vi.fn()} mobile />);
    const input = screen.getByLabelText(zhCN.upload.inputLabel) as HTMLInputElement;
    // jsdom 的 HTMLInputElement.capture 属性未实现，断言属性节点
    expect(input.getAttribute('capture')).toBe('environment');
    expect(screen.getByText(zhCN.upload.mobileHint)).toBeTruthy();
  });

  it('合法 PNG 触发 onValid（type/bytes/name 正确）', async () => {
    const onValid = vi.fn();
    render(<UploadDropzone onValid={onValid} />);
    const bytes = fixtureBytes('static.png');
    selectFiles([makeFile(bytes, 'photo.png', 'image/png')]);
    await waitFor(() => expect(onValid).toHaveBeenCalledTimes(1));
    const arg = onValid.mock.calls[0][0];
    expect(arg.type).toBe('png');
    expect(arg.name).toBe('photo.png');
    expect(arg.bytes).toHaveLength(bytes.length);
  });

  it('超过 20 MB 的文件拒绝并显示文案（E1/E8 文件级）', async () => {
    render(<UploadDropzone onValid={vi.fn()} />);
    const big = new Uint8Array(LIMITS.maxFileBytes + 1);
    selectFiles([makeFile(big, 'big.png', 'image/png')]);
    await screen.findByText(zhCN.errors.TOO_LARGE_FILE);
  });

  it('动画 GIF 拒绝并显示文案（E4）', async () => {
    const onValid = vi.fn();
    render(<UploadDropzone onValid={onValid} />);
    selectFiles([makeFile(fixtureBytes('animated-2frames.gif'), 'anim.gif', 'image/gif')]);
    await screen.findByText(zhCN.errors.ANIMATED);
    expect(onValid).not.toHaveBeenCalled();
  });

  it('文本文件伪装成 jpg 拒绝并显示文案（E3）', async () => {
    render(<UploadDropzone onValid={vi.fn()} />);
    selectFiles([makeFile(fixtureBytes('text-as-photo.jpg'), 'photo.jpg', 'image/jpeg')]);
    await screen.findByText(zhCN.errors.UNSUPPORTED_TYPE);
  });

  it('空文件拒绝（E1）', async () => {
    render(<UploadDropzone onValid={vi.fn()} />);
    selectFiles([makeFile(new Uint8Array(0), 'empty.png', 'image/png')]);
    await screen.findByText(zhCN.errors.EMPTY_FILE);
  });

  it('多文件只处理第一张', async () => {
    const onValid = vi.fn();
    render(<UploadDropzone onValid={onValid} />);
    selectFiles([
      makeFile(fixtureBytes('static.png'), 'first.png', 'image/png'),
      makeFile(fixtureBytes('animated-2frames.gif'), 'second.gif', 'image/gif'),
    ]);
    await waitFor(() => expect(onValid).toHaveBeenCalledTimes(1));
    expect(onValid.mock.calls[0][0].name).toBe('first.png');
  });

  it('错误后点击「重新选择」清空错误', async () => {
    render(<UploadDropzone onValid={vi.fn()} />);
    selectFiles([makeFile(new Uint8Array(0), 'empty.png', 'image/png')]);
    await screen.findByText(zhCN.errors.EMPTY_FILE);
    fireEvent.click(screen.getByRole('button', { name: zhCN.upload.retry }));
    expect(screen.queryByText(zhCN.errors.EMPTY_FILE)).toBeNull();
  });

  it('disabled 时不响应点击选择', () => {
    render(<UploadDropzone onValid={vi.fn()} disabled />);
    const zone = screen.getByRole('button', { name: zhCN.upload.selectFile });
    expect(zone.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('errorMessage 映射完整性（spec §F1）', () => {
  it('每个 ImageErrorCode 都有对应文案', () => {
    const codes: ImageErrorCode[] = [
      'EMPTY_FILE',
      'UNSUPPORTED_TYPE',
      'TOO_LARGE_FILE',
      'TOO_MANY_PIXELS',
      'ANIMATED',
      'DECODE_FAILED',
      'HEIC_UNSUPPORTED',
    ];
    for (const code of codes) {
      expect(errorMessage(code), code).toBeTruthy();
      expect(errorMessage(code), code).not.toBe(code); // 不是原样返回码
    }
  });
});
