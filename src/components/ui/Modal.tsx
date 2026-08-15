'use client';

/**
 * 通用模态弹窗：遮罩点击/Esc 关闭、自动聚焦首个控件、窄屏 max-w 保护。
 * 全站弹窗统一使用，保证键盘可达性一致。
 */
import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  /** 弹窗可访问名称（aria-label）。 */
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** 面板额外样式（宽度/边框色等）。 */
  panelClassName?: string;
}

export default function Modal({ label, onClose, children, panelClassName = '' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc 关闭
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // 自动聚焦首个可聚焦控件
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>('input, select, textarea, button');
    first?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`rounded border border-gray-300 bg-white p-4 shadow-lg ${panelClassName}`}
      >
        {children}
      </div>
    </div>
  );
}
