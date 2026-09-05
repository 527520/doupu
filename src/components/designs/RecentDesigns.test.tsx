// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_GENERATION_PARAMS, type ProjectFile } from '@/lib/types';
import { createStitchProgress } from '@/lib/progress/stitchProgress';
import RecentDesigns from './RecentDesigns';

it('最近设计来自本机记录，继续跟拼使用该设计的真实进度', async () => {
  const project: ProjectFile = {
    format: 'doupu-project', version: 3, engineVersion: '2.0.0', name: '我的樱桃',
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    boardProfile: '5mm-29', paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 },
    params: DEFAULT_GENERATION_PARAMS,
    pattern: { width: 2, height: 1, cells: [{ hex: '#FC3D46', code: 'F02', transparent: false }, { hex: '#FC3D46', code: 'F02', transparent: false }] },
  };
  const progress = createStitchProgress(2, 1); progress.done[0] = 1;
  render(<RecentDesigns storage={{
    getAll: async () => [{ id: 'cherry', name: project.name, projectJson: JSON.stringify(project), thumbnail: null, updatedAt: project.updatedAt }],
    getStitchProgress: async () => progress,
  }} />);
  expect(await screen.findByRole('link', { name: /继续跟拼.*我的樱桃/ })).toHaveAttribute('href', '/app?id=cherry&mode=stitch');
  expect(screen.getByText('已拼 50%')).toBeVisible();
  expect(screen.queryByText('郁金香与蝴蝶结')).not.toBeInTheDocument();
});

it('没有本地设计时不显示示例卡片，只有真实空态与设计库入口', async () => {
  render(<RecentDesigns storage={{ getAll: async () => [], getStitchProgress: async () => null }} />);
  expect(await screen.findByText(/还没有本机设计/)).toBeVisible();
  expect(screen.queryByRole('link', { name: /继续制作：|继续跟拼：/ })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '全部设计' })).toHaveAttribute('href', '/designs');
});

it('读取失败明确提示，重试成功后恢复真实空态而不是继续报错', async () => {
  const getAll = vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue([]);
  render(<RecentDesigns storage={{ getAll, getStitchProgress: async () => null }} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '重试' }));
  expect(await screen.findByText(/还没有本机设计/)).toBeVisible();
  expect(screen.queryByText(/暂时无法读取/)).not.toBeInTheDocument();
});

it('损坏或旧协议记录不冒充可继续的设计', async () => {
  render(<RecentDesigns storage={{ getAll: async () => [{ id: 'broken', name: '损坏图纸', thumbnail: null, projectJson: '{}', updatedAt: '' }], getStitchProgress: async () => null }} />);
  expect(await screen.findByText(/暂时无法读取本机设计/)).toBeVisible();
  expect(screen.queryByText('损坏图纸')).not.toBeInTheDocument();
});
