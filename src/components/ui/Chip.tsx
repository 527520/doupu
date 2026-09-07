/**
 * 筛选芯片（site-ui-overhaul 02）：可按下的小胶囊，选中时像一颗压上板的豆。
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode;
  pressed?: boolean;
  count?: number;
}

export default function Chip({ children, pressed = false, count, className = '', type = 'button', ...rest }: ChipProps) {
  return <button type={type} aria-pressed={pressed} className={`chip${className ? ` ${className}` : ''}`} {...rest}>
    <span>{children}</span>{count !== undefined && <small>{count}</small>}
  </button>;
}
