// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsConsentBanner } from './AnalyticsConsent';

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
});
