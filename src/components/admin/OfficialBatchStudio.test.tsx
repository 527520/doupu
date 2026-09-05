// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import OfficialBatchStudio from './OfficialBatchStudio';

afterEach(() => vi.unstubAllGlobals());

it('does not overwrite freshly selected files with a late restoration response', async () => {
  let complete!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; })));
  render(<OfficialBatchStudio />);
  fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [new File(['image'], 'fresh.png', { type: 'image/png' })] } });
  expect(screen.getByText(/fresh.png/)).toBeTruthy();
  await act(async () => complete(new Response(JSON.stringify({ items: [{ id: 'old', version: 1, status: 'completed', drafts: [{ id: 'old-revision', title: '旧作品', status: 'published' }] }] }))));
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
  await act(async () => undefined);
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
  expect(start).not.toBeDisabled(); expect(fileInput).not.toBeDisabled();
});
