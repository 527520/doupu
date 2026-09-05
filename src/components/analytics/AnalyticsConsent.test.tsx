// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsConsentBanner, AnalyticsConsentSettings } from './AnalyticsConsent';

const { track, clearAnalyticsQueue } = vi.hoisted(() => ({
  track: vi.fn(),
  clearAnalyticsQueue: vi.fn(),
}));
vi.mock('@/lib/analytics/client', () => ({ track, clearAnalyticsQueue }));

describe('analytics consent banner', () => {
  beforeEach(() => {
    document.cookie = 'doupu_analytics_consent=; Max-Age=0; Path=/';
    track.mockReset();
    clearAnalyticsQueue.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'granted' }), { status: 200 })));
  });

  it('waits for an explicit choice and does not track a refusal', async () => {
    render(<AnalyticsConsentBanner />);
    fireEvent.click(await screen.findByRole('button', { name: '拒绝' }));
    await waitFor(() => expect(screen.queryByLabelText('匿名使用数据偏好')).not.toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith('/api/analytics/consent', expect.objectContaining({ body: '{"status":"denied"}' }));
    expect(clearAnalyticsQueue).toHaveBeenCalledOnce();
    expect(track).not.toHaveBeenCalled();
  });

  it('records only the current page view after consent succeeds', async () => {
    window.history.replaceState({}, '', '/community');
    render(<AnalyticsConsentBanner />);
    fireEvent.click(await screen.findByRole('button', { name: '同意匿名统计' }));
    await waitFor(() => expect(track).toHaveBeenCalledWith({
      name: 'page_viewed', properties: { surface: 'community' },
    }));
  });

  it('stops immediately on withdrawal, persists the intent on failure, and allows only deletion retry', async () => {
    document.cookie = 'doupu_analytics_consent=granted; Path=/';
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<AnalyticsConsentSettings />);
    fireEvent.click(await screen.findByRole('button', { name: '撤回并清除原始数据' }));
    expect(clearAnalyticsQueue).toHaveBeenCalledOnce();
    expect(document.cookie).not.toContain('doupu_analytics_consent=granted');
    finish(new Response('{}', { status: 503 }));
    expect(await screen.findByRole('alert')).toHaveTextContent('已停止采集');
    expect(screen.getByRole('button', { name: '同意' })).toBeDisabled();
    view.unmount();
    render(<AnalyticsConsentSettings />);
    fireEvent.click(await screen.findByRole('button', { name: '重试清除原始数据' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已撤回同意并清除'));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(track).not.toHaveBeenCalled();
  });

  it('shares choices and request guards between settings and banner', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<><AnalyticsConsentBanner /><AnalyticsConsentSettings /></>);
    await screen.findByRole('button', { name: '同意匿名统计' });
    await waitFor(() => expect(screen.getByRole('button', { name: '同意' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '同意' }));
    fireEvent.click(screen.getByRole('button', { name: '同意匿名统计' }));
    expect(fetch).toHaveBeenCalledOnce();
    finish(new Response('{}', { status: 200 }));
    await waitFor(() => expect(screen.queryByLabelText('匿名使用数据偏好')).not.toBeInTheDocument());
    expect(screen.getByText('当前状态：已同意')).toBeInTheDocument();
    expect(track).toHaveBeenCalledOnce();
  });
});
