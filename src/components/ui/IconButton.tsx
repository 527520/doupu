/**
 * 豆粒按钮（site-ui-overhaul 01）：纯图标操作的统一形态。
 *
 * 圆环像一颗还没上板的豆；hover 中心填色；`pressed` 时实心莓果并留一圈内环高光（豆孔）。
 * 图标本身没有文字，所以 `label` 必填并同时写入 aria-label 与 title。
 */
import type { ButtonHTMLAttributes } from 'react';
import Icon, { type IconName } from './Icon';

export type IconButtonTone = 'neutral' | 'primary' | 'danger' | 'inverse';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  icon: IconName;
  /** 可访问名称，同时作为悬停提示。 */
  label: string;
  /** 切换态（点赞 / 已选）。 */
  pressed?: boolean;
  tone?: IconButtonTone;
  size?: 'md' | 'sm';
  /** 切换成功时图标做一次落位动画（默认开启，减少动态时由 CSS 关闭）。 */
  settle?: boolean;
}

export default function IconButton({ icon, label, pressed, tone = 'neutral', size = 'md', settle = true, className, type = 'button', ...rest }: IconButtonProps) {
  const classes = ['btn-bead', size === 'sm' ? 'btn-bead-sm' : '', settle ? 'btn-bead-settle' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} aria-label={label} title={label} aria-pressed={pressed} data-tone={tone === 'neutral' ? undefined : tone} {...rest}>
      <Icon name={icon} size={size === 'sm' ? 16 : 18} />
    </button>
  );
}
