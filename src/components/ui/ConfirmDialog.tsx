'use client';

/**
 * 品牌确认弹窗（C-7）。
 *
 * 此前破坏性操作有两条并存的路径：一部分用品牌 Modal（清空图纸、删除账号、
 * 删除设计），另一部分用浏览器原生 `window.confirm`（重新生成会丢修补、
 * 离开页面、删除色板、覆盖色板行）。原生弹窗不遵循站点视觉、在 iOS 上样式突兀，
 * 且不受焦点管理约束。这里提供 Promise 化的确认，让原来 `if (window.confirm(...))`
 * 的同步写法只需改成 `if (await confirm(...))`。
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import Modal from './Modal';
import { zhCN } from '@/messages/zh-CN';

export interface ConfirmRequest {
  /** 弹窗标题，同时作为可访问名称。 */
  title: string;
  /** 补充说明（可省略）。 */
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 破坏性操作：确认按钮用危险色。 */
  danger?: boolean;
}

export function useConfirm(): {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  confirmDialog: ReactNode;
} {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean): void => {
    setRequest(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(value);
  }, []);

  const confirm = useCallback((next: ConfirmRequest): Promise<boolean> => {
    // 同一时刻只允许一个确认：新的请求让旧的按「取消」结束，避免悬挂的 Promise。
    resolverRef.current?.(false);
    setRequest(next);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const confirmDialog = request === null ? null : (
    <Modal label={request.title} onClose={() => settle(false)} panelClassName="max-w-sm">
      <h2 className="mb-2 text-base font-medium text-ink">{request.title}</h2>
      {request.message && <p className="mb-4 text-sm text-ink-soft">{request.message}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => settle(false)} className="btn-outline">
          {request.cancelLabel ?? zhCN.designs.cancel}
        </button>
        <button
          type="button"
          onClick={() => settle(true)}
          className={request.danger
            ? 'inline-flex items-center justify-center rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-danger/90'
            : 'btn-primary'}
        >
          {request.confirmLabel ?? zhCN.common.confirm}
        </button>
      </div>
    </Modal>
  );

  return { confirm, confirmDialog };
}
