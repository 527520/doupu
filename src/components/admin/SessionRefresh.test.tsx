// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SessionRefresh from './SessionRefresh';

let pathname = '/admin/analytics';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
afterEach(() => vi.unstubAllGlobals());

it('renews through an HTTP response on read-only admin navigation and foreground activity', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<SessionRefresh />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  pathname = '/admin/system';
  view.rerender(<SessionRefresh />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  fireEvent.focus(window);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(fetcher).toHaveBeenLastCalledWith('/api/auth/me', { cache: 'no-store' });
  fetcher.mockRejectedValue(new Error('offline'));
  fireEvent.focus(window);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
  view.unmount();
  fireEvent.focus(window);
  expect(fetcher).toHaveBeenCalledTimes(4);
});
