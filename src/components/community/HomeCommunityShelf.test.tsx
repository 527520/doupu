// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HomeCommunityShelf from './HomeCommunityShelf';

vi.mock('./CommunityPreviewCanvas', () => ({ default: () => <canvas /> }));
afterEach(() => vi.unstubAllGlobals());
const work = (id: string, featured: boolean) => ({ id, title: id, featured, width: 1, height: 1, author: { displayName: '豆友' }, preview: { version: 1, width: 1, height: 1, originalWidth: 1, originalHeight: 1, cells: ['#FFFFFF'], colorBand: ['#FFFFFF'] } });

describe('home community data states', () => {
  it('treats an incomplete preview as a retryable read failure, not an empty shelf or a render crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"items":[{"id":"one","featured":true}]}')));
    render(<HomeCommunityShelf />);
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取豆社作品');
    expect(screen.queryByText('还没有已公开作品。')).not.toBeInTheDocument();
  });
  it('distinguishes a failed request from an empty community and supports retry', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    render(<HomeCommunityShelf />);
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取豆社作品');
    fetcher.mockImplementation(async () => new Response('{"items":[]}'));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('还没有已公开作品。')).toBeVisible();
    expect(screen.getByRole('link', { name: '打开豆社' })).toHaveAttribute('href', '/community');
  });

  it('shows selected proofs and independently queried latest works together', async () => {
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify({ items: [work(url.endsWith('featured') ? '旧作精选' : '今日新作', url.endsWith('featured'))] })));
    vi.stubGlobal('fetch', fetcher); render(<HomeCommunityShelf />);
    expect(await screen.findByRole('link', { name: /旧作精选/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /今日新作/ })).toBeVisible();
    expect(screen.getByRole('heading', { name: '最近公开作品' })).toBeVisible();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/community/works?sort=featured', '/api/community/works?sort=latest']);
  });

  it('does not label ordinary latest works as editorial selections', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [work('普通作品', false)] }))));
    render(<HomeCommunityShelf />);
    expect(await screen.findByRole('link', { name: /普通作品/ })).toBeVisible();
    expect(screen.queryByText('人工精选')).not.toBeInTheDocument();
  });
});
