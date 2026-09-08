/**
 * 筛选芯片（site-ui-overhaul 02 / ui-polish-2026）：可按下的小胶囊，选中时是软莓果底——像一颗压进底板的豆。
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Icon, { type IconName } from './Icon';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode;
  pressed?: boolean;
  count?: number;
  icon?: IconName;
  /** sm = 36（工具行，默认），xs = 32（密集行）。 */
  size?: 'sm' | 'xs';
}

export default function Chip({ children, pressed = false, count, icon, size = 'sm', className = '', type = 'button', ...rest }: ChipProps) {
  return <button type={type} aria-pressed={pressed} className={`chip${size === 'xs' ? ' is-xs' : ''}${className ? ` ${className}` : ''}`} {...rest}>
    {icon && <Icon name={icon} size={size === 'xs' ? 14 : 16} />}
    <span>{children}</span>{count !== undefined && <small>{count}</small>}
  </button>;
}
