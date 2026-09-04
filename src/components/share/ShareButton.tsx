'use client';

/**
 * 分享按钮（批次 K，决策 D38 取代 D23）。
 *
 * 产出一个只读链接 + 二维码。二维码是刚需而不是装饰：拼豆的实际场景是
 * 手机对着屏幕/纸看图，把链接做成二维码，朋友当面扫一下就能打开，
 * 不用在微信里传一串字符。
 *
 * 约束：
 * - 只有已登录且设计已同步到云端的情况才能分享（链接要服务端可解析）；
 * - 分享的是快照，作者之后继续编辑不影响已发出的链接（服务端固化）；
 * - 可随时「停止分享」，旧链接立即失效。
 */
import { useCallback, useState } from 'react';
import { encodeQR } from 'qr';
import Modal from '@/components/ui/Modal';
import Notice from '@/components/ui/Notice';
import { zhCN } from '@/messages/zh-CN';
import { track } from '@/lib/analytics/client';

interface Props {
  designId: string;
  /**
   * 分享前的准备：先把设计保存并推到云端（只读页要服务端能查到快照）。
   * 返回 false 表示准备失败（未登录/本地存储不可用/推送失败），此时不发请求。
   */
  onBeforeShare?: () => Promise<boolean>;
  /** 未登录或还没有图纸时禁用。 */
  disabled?: boolean;
  disabledReason?: string;
}

type State =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'ready'; url: string; svg: string }
  | { kind: 'failed'; message: string };

export default function ShareButton({ designId, onBeforeShare, disabled, disabledReason }: Props) {
  const t = zhCN.share;
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  const createShare = useCallback(async (): Promise<void> => {
    setState({ kind: 'creating' });
    setCopied(false);
    setStopError(null);
    try {
      // 先确保这张图纸已经在云端：只读页由服务端渲染快照，本地没推上去就打不开。
      // 这里不能只看「云端：已同步」徽标——它表示上一次同步跑完了，
      // 不代表当前这张设计已经被推送（实测就踩到了这个坑）。
      if (onBeforeShare && !(await onBeforeShare())) {
        setState({ kind: 'failed', message: t.notSyncedYet });
        return;
      }
      const response = await fetch(`/api/designs/${designId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
        // 404 = 云端还没有这张设计：给出可执行的下一步，而不是「设计不存在」这种内部说法
        const message = body?.error?.code === 'NOT_FOUND'
          ? t.notSyncedYet
          : body?.error?.message ?? t.createFailed;
        setState({ kind: 'failed', message });
        return;
      }
      const body = (await response.json()) as { path: string };
      const url = new URL(body.path, window.location.origin).toString();
      // 二维码在浏览器端生成：链接不必再发一次给任何服务端
      const svg = encodeQR(url, 'svg', { ecc: 'medium', border: 2 });
      setState({ kind: 'ready', url, svg });
      track({ name: 'share_created', properties: {} });
    } catch {
      setState({ kind: 'failed', message: t.createFailed });
    }
  }, [designId, onBeforeShare, t.createFailed, t.notSyncedYet]);

  const stopShare = useCallback(async (): Promise<void> => {
    setStopError(null);
    try {
      const response = await fetch(`/api/designs/${designId}/share`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error(`stop share failed: ${response.status}`);
    } catch {
      // 失败时旧链接仍可能有效，必须保留 ready 状态和链接供用户重试。
      setStopError(t.stopFailed);
      return;
    }
    setState({ kind: 'idle' });
    setOpen(false);
    track({ name: 'share_revoked', properties: {} });
  }, [designId, t.stopFailed]);

  const copyLink = async (): Promise<void> => {
    if (state.kind !== 'ready') return;
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); void createShare(); }}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        className="btn-outline btn-sm"
      >
        {t.button}
      </button>

      {open && (
        <Modal label={t.dialogTitle} onClose={() => setOpen(false)} panelClassName="max-w-sm">
          <h2 className="mb-2 text-base font-medium text-ink">{t.dialogTitle}</h2>
          <p className="mb-3 text-xs text-ink-soft">{t.dialogHint}</p>

          {state.kind === 'creating' && <p role="status" className="text-sm text-ink-soft">{t.creating}</p>}
          {state.kind === 'failed' && <Notice kind="danger">{state.message}</Notice>}
          {stopError && <Notice kind="danger">{stopError}</Notice>}

          {state.kind === 'ready' && (
            <div className="flex flex-col gap-3">
              <div
                aria-label={t.qrAria}
                role="img"
                className="mx-auto w-40 [&>svg]:h-full [&>svg]:w-full"
                // 二维码由本地库生成的静态 SVG，不含用户输入
                dangerouslySetInnerHTML={{ __html: state.svg }}
              />
              <p className="break-all rounded-xl bg-cream-deep/60 p-2 font-mono text-xs text-ink">{state.url}</p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void copyLink()} className="btn-primary btn-sm">
                  {t.copyLink}
                </button>
                {copied && <span className="text-xs text-success">{t.copied}</span>}
                <button type="button" onClick={() => void stopShare()} className="btn-danger-outline btn-xs">
                  {t.stop}
                </button>
              </div>
              <p className="text-xs text-ink-soft">{t.snapshotNote}</p>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button type="button" onClick={() => setOpen(false)} className="btn-outline btn-sm">
              {zhCN.common.close}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
