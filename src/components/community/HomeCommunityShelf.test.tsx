// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HomeCommunityShelf from './HomeCommunityShelf';

describe('home community data states', () => {
  it('distinguishes a failed request from an empty community and supports retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response('{"items":[]}')));
    render(<HomeCommunityShelf />);
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取豆社作品');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('还没有已公开作品。')).toBeVisible();
    expect(screen.getByRole('link', { name: '打开豆社' })).toHaveAttribute('href', '/community');
  });
});
