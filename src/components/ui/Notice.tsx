/**
 * 提示条（C-4）。
 *
 * 全站原有 20+ 处「正在加载 / 警示 / 失败 / 成功」提示各写一套 Tailwind 配方，
 * 仅琥珀色警示条就有三种不同写法（Workbench 里四条相邻提示条颜色都不一致）。
 * 统一到一个组件后：语气由 kind 决定，样式来自 globals.css 的 .notice-* token，
 * 改一次配色全站生效。
 *
 * 无障碍：danger 用 role="alert"（打断播报，用户需要立刻知道操作失败），
 * 其余用 role="status"（礼貌播报，不打断当前朗读）。可用 role 覆盖。
 */
import type { ReactNode } from 'react';

export type NoticeKind = 'info' | 'success' | 'warning' | 'danger';

interface Props {
  kind?: NoticeKind;
  children: ReactNode;
  /** 紧凑变体：工具条或表单项下方的一行提示 */
  compact?: boolean;
  className?: string;
  /** 覆盖默认播报语义（例如纯装饰性提示传 'none'） */
  role?: 'status' | 'alert' | 'none';
  id?: string;
  /** 含块级内容（标题+列表）时用 div；默认 p 只能放行内内容。 */
  as?: 'p' | 'div';
}

export default function Notice({ kind = 'info', children, compact, className, role, id, as = 'p' }: Props) {
  const resolvedRole = role ?? (kind === 'danger' ? 'alert' : 'status');
  const Tag = as;
  return (
    <Tag
      id={id}
      {...(resolvedRole === 'none' ? {} : { role: resolvedRole })}
      className={[
        'notice',
        `notice-${kind}`,
        compact ? 'notice-compact' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
    >
      {children}
    </Tag>
  );
}
