// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import OfficialBatchStudio from './OfficialBatchStudio';

afterEach(() => vi.unstubAllGlobals());

it('shows invalid file selection errors even before a batch exists', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"items":[]}')));
  render(<OfficialBatchStudio />);
  fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [new File(['x'], 'private.txt', { type: 'text/plain' })] } });
  expect(screen.getByRole('alert')).toHaveTextContent('批次只接受图片文件');
  await waitFor(() => expect(screen.getByText('暂无已保存批次。')).toBeInTheDocument());
});

it('requires explicit confirmation before replacing still-local files', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"items":[]}')));
  render(<OfficialBatchStudio />);
  const input = screen.getByLabelText('选择图片');
  fireEvent.change(input, { target: { files: [new File(['a'], 'first.png', { type: 'image/png' })] } });
  fireEvent.change(input, { target: { files: [new File(['b'], 'second.png', { type: 'image/png' })] } });
  expect(screen.getByText(/first.png/)).toBeInTheDocument(); expect(screen.queryByText(/second.png/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '保留当前任务' }));
  fireEvent.change(input, { target: { files: [new File(['b'], 'second.png', { type: 'image/png' })] } });
  fireEvent.click(screen.getByRole('button', { name: '释放本地任务并切换' }));
  expect(screen.getByText(/second.png/)).toBeInTheDocument(); expect(screen.queryByText(/first.png/)).toBeNull();
  await waitFor(() => expect(screen.getByText('暂无已保存批次。')).toBeInTheDocument());
});

it('does not overwrite freshly selected files with a late restoration response', async () => {
  let complete!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; })));
  render(<OfficialBatchStudio />);
  fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [new File(['image'], 'fresh.png', { type: 'image/png' })] } });
  expect(screen.getByText(/fresh.png/)).toBeTruthy();
  await waitFor(() => expect(complete).toBeTypeOf('function'));
  await act(async () => complete(new Response(JSON.stringify({ items: [{ id: 'old', version: 1, status: 'completed', createdAt: '2026-09-01', successCount: 1, itemCount: 1, drafts: [{ id: 'old-revision', title: '旧作品', status: 'published' }] }] }))));
  expect(screen.getByText(/fresh.png/)).toBeTruthy();
  expect(screen.queryByDisplayValue('旧作品')).toBeNull();
  expect(screen.getByRole('button', { name: '开始生成' })).not.toBeDisabled();
});

it('locks the selected file set and rejects duplicate starts while batch creation is pending', async () => {
  let complete!: (response: Response) => void;
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"items":[]}'))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  render(<OfficialBatchStudio />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const fileInput = screen.getByLabelText('选择图片');
  fireEvent.change(fileInput, { target: { files: [new File(['image'], 'first.png', { type: 'image/png' })] } });
  const start = screen.getByRole('button', { name: '开始生成' });
  fireEvent.click(start); fireEvent.click(start);
  expect(start).toBeDisabled(); expect(fileInput).toBeDisabled();
  fireEvent.change(fileInput, { target: { files: [new File(['second'], 'replaced.png', { type: 'image/png' })] } });
  expect(screen.getByText(/first.png/)).toBeTruthy();
  expect(screen.queryByText(/replaced.png/)).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => complete(new Response('{}', { status: 500 })));
  expect(start).toBeDisabled(); expect(fileInput).toBeDisabled();
  expect(screen.getByRole('button', { name: '重试确认上次操作' })).toBeEnabled();
});
