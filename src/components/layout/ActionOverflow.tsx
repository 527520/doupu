'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { zhCN } from '@/messages/zh-CN';
import Icon from '@/components/ui/Icon';

interface Props {
  actions: ReactNode;
}

/** 页面与项目操作栏共用的可访问溢出菜单。 */
export default function ActionOverflow({ actions }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  return (
    <div ref={rootRef} className="workspace-overflow">
      <button
        ref={triggerRef}
        type="button"
        className="icon-button"
        aria-label={zhCN.nav.more}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" />
      </button>
      <div
        id={panelId}
        data-testid="site-overflow-panel"
        hidden={!open}
        className={`workspace-overflow-panel${open ? ' is-open' : ''}`}
        onClickCapture={(event) => {
          if ((event.target as Element).closest('a, button')) setOpen(false);
        }}
      >
        {actions}
      </div>
    </div>
  );
}
