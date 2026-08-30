// @vitest-environment jsdom
/**
 * 分享按钮（批次 K）：生成链接 + 二维码、复制、停止分享、失败反馈。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ShareButton from './ShareButton';
import { zhCN } from '@/messages/zh-CN';

const DESIGN_ID = '00000000-0000-4000-8000-0000000000a1';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ token: 'tok_abcdefghijklmnop', path: '/s/tok_abcdefghijklmnop' }),
    { status: 201, headers: { 'content-type': 'application/json' } },
  )));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ShareButton', () => {
  it('点击后创建链接并渲染二维码（SVG）与可复制的完整 URL', async () => {
    render(<ShareButton designId={DESIGN_ID} />);
    fireEvent.click(screen.getByRole('button', { name: zhCN.share.button }));

    const qr = await screen.findByRole('img', { name: zhCN.share.qrAria });
    expect(qr.querySelector('svg')).toBeTruthy();
    expect(screen.getByText(new RegExp('/s/tok_abcdefghijklmnop'))).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      `/api/designs/${DESIGN_ID}/share`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('复制链接写入剪贴板', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<ShareButton designId={DESIGN_ID} />);
    fireEvent.click(screen.getByRole('button', { name: zhCN.share.button }));
    fireEvent.click(await screen.findByRole('button', { name: zhCN.share.copyLink }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0][0])).toContain('/s/tok_abcdefghijklmnop');
    expect(await screen.findByText(zhCN.share.copied)).toBeTruthy();
  });

  it('停止分享调用 DELETE 并关闭弹窗', async () => {
    render(<ShareButton designId={DESIGN_ID} />);
    fireEvent.click(screen.getByRole('button', { name: zhCN.share.button }));
    fireEvent.click(await screen.findByRole('button', { name: zhCN.share.stop }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/designs/${DESIGN_ID}/share`,
      expect.objectContaining({ method: 'DELETE' }),
    ));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it.each(['http', 'network'] as const)('停止分享发生 %s 失败时保留旧链接并提示重试', async (failure) => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        if (failure === 'network') throw new Error('offline');
        return new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'failed' } }), { status: 500 });
      }
      return new Response(
        JSON.stringify({ token: 'tok_abcdefghijklmnop', path: '/s/tok_abcdefghijklmnop' }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }));
    render(<ShareButton designId={DESIGN_ID} />);
    fireEvent.click(screen.getByRole('button', { name: zhCN.share.button }));
    await screen.findByRole('img', { name: zhCN.share.qrAria });

    fireEvent.click(screen.getByRole('button', { name: zhCN.share.stop }));

    expect(await screen.findByText(zhCN.share.stopFailed)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(new RegExp('/s/tok_abcdefghijklmnop'))).toBeTruthy();
    expect(screen.getByRole('button', { name: zhCN.share.stop })).toBeTruthy();
  });

  it('服务端拒绝时显示服务端给的原因，不假装成功', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 'VALIDATION', message: '这个设计还没有可分享的图纸' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )));
    render(<ShareButton designId={DESIGN_ID} />);
    fireEvent.click(screen.getByRole('button', { name: zhCN.share.button }));
    expect(await screen.findByText('这个设计还没有可分享的图纸')).toBeTruthy();
    expect(screen.queryByRole('img', { name: zhCN.share.qrAria })).toBeNull();
  });

  it('分享前先确保已保存并推送到云端；准备失败时给出可执行提示而不是发请求', async () => {
    const onBeforeShare = vi.fn().mockResolvedValue(false);
    render(<ShareButton designId={DESIGN_ID} onBeforeShare={onBeforeShare} />);
    fireEvent.click(screen.getByRole('button', { name: zhCN.share.button }));
    expect(await screen.findByText(zhCN.share.notSyncedYet)).toBeTruthy();
    expect(onBeforeShare).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('服务端说云端没有这张设计时，给出「先保存再分享」而不是「设计不存在」', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 'NOT_FOUND', message: '设计不存在' } }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    )));
    render(<ShareButton designId={DESIGN_ID} />);
    fireEvent.click(screen.getByRole('button', { name: zhCN.share.button }));
    expect(await screen.findByText(zhCN.share.notSyncedYet)).toBeTruthy();
    expect(screen.queryByText('设计不存在')).toBeNull();
  });

  it('未登录时按钮禁用并说明原因', () => {
    render(<ShareButton designId={DESIGN_ID} disabled disabledReason={zhCN.share.requiresCloud} />);
    const button = screen.getByRole('button', { name: zhCN.share.button });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', zhCN.share.requiresCloud);
  });
});
