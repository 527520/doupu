'use client';

/**
 * 通用模态弹窗：遮罩点击/Esc 关闭、自动聚焦首个控件、窄屏 max-w 保护。
 * 全站弹窗统一使用，保证键盘可达性一致。
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  /** 弹窗可访问名称（aria-label）。 */
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** 面板额外样式（宽度/边框色等）。 */
  panelClassName?: string;
  panelStyle?: CSSProperties;
  testId?: string;
}

export default function Modal({ label, onClose, children, panelClassName = '', panelStyle, testId }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [portalRoot] = useState<HTMLDivElement | null>(() => {
    if (typeof document === 'undefined') return null;
    const root = document.createElement('div');
    root.dataset.modalRoot = '';
    return root;
  });

  useLayoutEffect(() => {
    if (!portalRoot) return;
    document.body.append(portalRoot);
    return () => portalRoot.remove();
  }, [portalRoot]);

  // Portal 使弹窗与应用根节点成为兄弟节点，因而可以真实地将背景
  // inert，而不会连弹窗自身一并禁用。清理时逐项恢复调用方原状态。
  useLayoutEffect(() => {
    if (!portalRoot) return;
    const background = Array.from(document.body.children).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== portalRoot,
    );
    const snapshots = background.map((element) => ({
      element,
      inert: element.hasAttribute('inert'),
      ariaHidden: element.getAttribute('aria-hidden'),
    }));
    for (const element of background) {
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      for (const snapshot of snapshots) {
        if (!snapshot.inert) snapshot.element.removeAttribute('inert');
        if (snapshot.ariaHidden === null) snapshot.element.removeAttribute('aria-hidden');
        else snapshot.element.setAttribute('aria-hidden', snapshot.ariaHidden);
      }
      document.body.style.overflow = previousOverflow;
    };
  }, [portalRoot]);

  // Esc 关闭；Tab/Shift+Tab 始终在弹窗内循环。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // 上层确认框会将当前 Portal 设为 inert；仅最上层弹窗处理键盘。
      if (portalRoot?.hasAttribute('inert')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      const panel = panelRef.current;
      if (!panel) return;
      const controls = focusableElements(panel);
      if (controls.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      // Safari 的系统键盘设置可能跳过按钮。显式循环所有可操作控件，
      // 不能依赖浏览器的首尾判定，否则 Shift+Tab 会离开沉浸层。
      event.preventDefault();
      const index = controls.findIndex((element) => element === document.activeElement);
      const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      controls[next].focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, portalRoot]);

  // 自动聚焦首个可聚焦控件；关闭后恢复打开弹窗前的焦点。
  useEffect(() => {
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (!panel) return;
    const first = focusableElements(panel)[0];
    (first ?? panel).focus();
    return () => previousActive?.focus();
  }, []);

  if (!portalRoot) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        style={panelStyle}
        className={`w-full max-w-[calc(100vw-2rem)] rounded-2xl border border-lilac/30 bg-white p-4 shadow-soft ${panelClassName}`}
      >
        {children}
      </div>
    </div>,
    portalRoot,
  );
}

function focusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => {
    if (element.tabIndex < 0 || element.matches(':disabled, input[type="hidden"]')) return false;
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true') return false;
      if (node instanceof HTMLDetailsElement && !node.open && !node.querySelector('summary')?.contains(element)) return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (node === panel) break;
    }
    return true;
  });
}
