// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import OfficialBatchStudio from './OfficialBatchStudio';
import { zhCN } from '@/messages/zh-CN';
const decoder = vi.hoisted(() => ({ load: vi.fn(), dispose: vi.fn() }));
vi.mock('@/lib/image/decode', () => ({ createImageDecoder: () => decoder }));
vi.mock('@/lib/image/sniff', () => ({ sniffImageType: () => 'png' }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it.each(['DECODE_FAILED', 'HEIC_UNSUPPORTED', 'TOO_MANY_PIXELS'] as const)('cropping explains %s without exposing an internal error code', async (code) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"items":[]}')));
  decoder.load.mockResolvedValue(code === 'TOO_MANY_PIXELS'
    ? { ok: true, image: { width: 100, height: 100, naturalWidth: 10000, naturalHeight: 10000 } }
    : { ok: false, code });
  render(<OfficialBatchStudio />);
  await waitFor(() => expect(screen.getByText('暂无已保存批次。')).toBeInTheDocument());
  const file = Object.assign(new File(['local'], 'local.png', { type: 'image/png' }), { arrayBuffer: async () => new ArrayBuffer(4) });
  fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: '预览并裁剪' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(zhCN.errors[code]);
  expect(screen.getByRole('alert')).not.toHaveTextContent(code);
  expect(decoder.dispose).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
