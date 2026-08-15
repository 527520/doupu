// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({}));

import NotFound from './not-found';
import PageError from './error';

describe('404 页', () => {
  it('显示友好文案与首页/工作台入口', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { name: '页面不存在' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '返回首页' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: '去工作台' }).getAttribute('href')).toBe('/app');
  });
});

describe('页面错误边界', () => {
  it('显示友好文案，点击重试调用 reset', () => {
    const reset = vi.fn();
    render(<PageError error={new Error('boom')} reset={reset} />);
    expect(screen.getByRole('heading', { name: '页面出错了' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('提供返回首页入口', () => {
    render(<PageError error={new Error('boom')} reset={vi.fn()} />);
    expect(screen.getByRole('link', { name: '返回首页' }).getAttribute('href')).toBe('/');
  });
});
