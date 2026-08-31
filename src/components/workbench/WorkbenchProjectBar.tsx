'use client';

import type { ReactNode } from 'react';
import ActionOverflow from '@/components/layout/ActionOverflow';
import { zhCN } from '@/messages/zh-CN';

interface Props {
  context: ReactNode;
  actions: ReactNode;
  overflowActions?: ReactNode;
}

/** 当前设计的名称、保存状态与操作；与全局 SiteHeader 保持独立职责。 */
export default function WorkbenchProjectBar({ context, actions, overflowActions }: Props) {
  return (
    <section className="workspace-project-bar" role="region" aria-label={zhCN.workspace.projectActions}>
      <div className="workspace-context">{context}</div>
      <div className={`workspace-project-actions${overflowActions ? ' has-overflow' : ''}`}>
        {actions}
        {overflowActions ? <ActionOverflow actions={overflowActions} /> : null}
      </div>
    </section>
  );
}
