'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { zhCN } from '@/messages/zh-CN';
import Icon from '@/components/ui/Icon';

interface Props {
  actions: ReactNode;
  label?: string;
  /** 面板锚定在触发器的哪一侧；默认右对齐（触发器通常在行尾）。 */
  align?: 'end' | 'start';
}

const ITEM_SELECTOR = 'a[href], button:not(:disabled)';

/**
 * 页面与项目操作栏共用的溢出菜单（ui-polish-2026）。
 *
 * 子项仍是调用方传入的真实 <a> / <button>——导航守卫（onNavigate）、表单语义与现有测试契约都不变；
 * 面板负责统一它们的观感（44px 菜单项、图标位、危险语气）、进场动效与方向键漫游。
 * 触发器是一颗豆粒（.btn-bead），与同一行的点赞 / 举报按钮同一轮廓。
 */
export default function ActionOverflow({ actions, label = zhCN.nav.more, align = 'end' }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const items = useCallback((): HTMLElement[] => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  // 方向键漫游：↓ / ↑ 在项目间移动并循环，Home / End 跳首尾；触发器上按 ↓ 直接打开并进入第一项。
  const moveFocus = (delta: number, from?: HTMLElement | null): void => {
    const list = items();
    if (list.length === 0) return;
    const index = from ? list.indexOf(from) : -1;
    const next = index < 0 ? (delta > 0 ? 0 : list.length - 1) : (index + delta + list.length) % list.length;
    list[next]?.focus();
  };
  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setOpen(true);
    requestAnimationFrame(() => moveFocus(event.key === 'ArrowDown' ? 1 : -1));
  };
  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const current = event.target instanceof HTMLElement ? event.target : null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); moveFocus(event.key === 'ArrowDown' ? 1 : -1, current); }
    else if (event.key === 'Home') { event.preventDefault(); items()[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); items().at(-1)?.focus(); }
  };

  return (
    <div ref={rootRef} className="workspace-overflow">
      <button
        ref={triggerRef}
        type="button"
        className="btn-bead"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onTriggerKeyDown}
      >
        <Icon name="more" size={18} />
      </button>
      <div
        id={panelId}
        ref={panelRef}
        role="region"
        aria-label={label}
        data-testid="site-overflow-panel"
        data-align={align}
        hidden={!open}
        className={`overflow-menu${open ? ' is-open' : ''}`}
        onKeyDown={onPanelKeyDown}
        onClickCapture={(event) => {
          if ((event.target as Element).closest('a, button')) {
            setOpen(false);
            // A dialog opened by this action should restore focus to the
            // visible trigger, not to an item in the now-hidden panel.
            triggerRef.current?.focus();
          }
        }}
      >
        {actions}
      </div>
    </div>
  );
}
