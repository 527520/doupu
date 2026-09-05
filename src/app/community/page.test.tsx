// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import CommunityPage from './page';

vi.mock('@/lib/auth/db', () => ({ getDb: () => ({}) }));
vi.mock('@/components/layout/SiteHeader', () => ({ default: () => <header /> }));
vi.mock('@/components/community/CommunityImpression', () => ({ CommunityListImpression: () => null }));
const query = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/community/queries', async (original) => ({ ...(await original<object>()), listPublicCommunityWorks: query.list }));

it('豆社下一页保留所有有效筛选，重设筛选不带旧游标', async () => {
  query.list.mockResolvedValue({ items: [], nextCursor: 'next/cursor+value' });
  render(await CommunityPage({ searchParams: Promise.resolve({ q: '花', author: '作者', tag: 'flowers', boardProfile: '5mm-29', palette: 'mard', from: '2026-09-01', to: '2026-09-05', sort: 'popular' }) }));
  const next = new URL(screen.getByRole('link', { name: '下一页' }).getAttribute('href')!, 'http://local');
  expect(Object.fromEntries(next.searchParams)).toEqual({ q: '花', author: '作者', tag: 'flowers', boardProfile: '5mm-29', palette: 'mard', from: '2026-09-01', to: '2026-09-05', sort: 'popular', cursor: 'next/cursor+value' });
  const form = document.querySelector('form')!;
  expect(new FormData(form).get('cursor')).toBeNull();
  expect(new FormData(form).get('author')).toBe('作者');
});

it('没有筛选结果时提供清除筛选，不把失败搜索说成社区没有作品', async () => {
  query.list.mockResolvedValue({ items: [], nextCursor: null });
  render(await CommunityPage({ searchParams: Promise.resolve({ q: '不存在的作品' }) }));
  expect(screen.getByText('没有符合这些条件的作品')).toBeVisible();
  expect(within(document.querySelector('.community-empty')!).getByRole('link', { name: '清除筛选' })).toHaveAttribute('href', '/community');
});

it('无效日期筛选提供恢复入口，不让整页变为服务器错误', async () => {
  render(await CommunityPage({ searchParams: Promise.resolve({ from: 'invalid-date' }) }));
  expect(screen.getByText('筛选条件无法识别')).toBeVisible();
  expect(screen.getByRole('link', { name: '清除筛选' })).toHaveAttribute('href', '/community');
});
