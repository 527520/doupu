// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OnboardingGuide from './OnboardingGuide';

function mockFetch(status: number): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('OnboardingGuide', () => {
  it('游客（/api/auth/me 401）且未关闭过 → 显示三步引导', async () => {
    mockFetch(401);
    render(<OnboardingGuide />);
    await waitFor(() => {
      expect(screen.getByLabelText('三步上手')).toBeTruthy();
    });
    expect(screen.getByText('上传照片或像素画')).toBeTruthy();
    expect(screen.getByText('调整尺寸与颜色参数')).toBeTruthy();
    expect(screen.getByText('修补细节并导出图纸')).toBeTruthy();
  });

  it('已登录（200）不显示', async () => {
    mockFetch(200);
    render(<OnboardingGuide />);
    await waitFor(() => {
      expect(screen.queryByLabelText('三步上手')).toBeNull();
    });
  });

  it('已关闭过（localStorage 标记）不显示，且不再发起会话请求', async () => {
    window.localStorage.setItem('doupu_onboarding_dismissed', '1');
    const fetchSpy = vi.fn().mockResolvedValue({ status: 401 });
    vi.stubGlobal('fetch', fetchSpy);
    render(<OnboardingGuide />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByLabelText('三步上手')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    window.localStorage.clear();
  });

  it('点击「我知道了」关闭并记住（localStorage 写入）', async () => {
    mockFetch(401);
    render(<OnboardingGuide />);
    await waitFor(() => {
      expect(screen.getByLabelText('三步上手')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('我知道了'));
    expect(screen.queryByLabelText('三步上手')).toBeNull();
    expect(window.localStorage.getItem('doupu_onboarding_dismissed')).toBe('1');
    window.localStorage.clear();
  });

  it('网络失败时静默不显示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    render(<OnboardingGuide />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByLabelText('三步上手')).toBeNull();
  });

  it('「开始制作」链接指向 /app', async () => {
    mockFetch(401);
    render(<OnboardingGuide />);
    await waitFor(() => {
      expect(screen.getByLabelText('三步上手')).toBeTruthy();
    });
    const link = screen.getByText('开始制作').closest('a');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('/app');
  });
});
