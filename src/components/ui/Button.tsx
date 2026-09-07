/**
 * 按钮（site-ui-overhaul 01）。
 *
 * 全站此前只有 6 种 CSS 类、35 个无 class 的裸按钮和 8 处根本没定义的 `btn-ghost`（现为 quiet 的别名），
 * 文字类操作看起来就是一行彩色小字。这里把「语气 × 尺寸 × 图标」收成一个组件，
 * 类名沿用旧名（btn-primary / btn-outline / btn-quiet / btn-danger-outline / btn-danger），
 * 让历史 className 用法与新组件共享同一套观感。
 *
 * 语气约定：每个视区最多一个 primary；quiet 用于取消 / 清除 / 收起这类低调动作；
 * danger 默认描边，只有确认弹窗里的最终动作用 dangerSolid。
 */
import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import Icon, { type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'dangerSolid' | 'tool';
export type ButtonSize = 'md' | 'sm' | 'xs';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-outline',
  quiet: 'btn-quiet',
  danger: 'btn-danger-outline',
  dangerSolid: 'btn-danger',
  tool: 'btn-tool',
};
const SIZE_CLASS: Record<ButtonSize, string> = { md: '', sm: 'btn-sm', xs: 'btn-xs' };
const ICON_SIZE: Record<ButtonSize, number> = { md: 18, sm: 16, xs: 14 };

export function buttonClassName(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string): string {
  return [VARIANT_CLASS[variant], SIZE_CLASS[size], className ?? ''].filter(Boolean).join(' ');
}

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconPosition?: 'start' | 'end';
  children?: ReactNode;
}

export interface ButtonProps extends CommonProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** 进行中：禁用并标注 aria-busy，文案由调用方切换（例如「保存中…」）。 */
  loading?: boolean;
}

export default function Button({ variant = 'secondary', size = 'md', icon, iconPosition = 'start', loading = false, className, children, type = 'button', disabled, ...rest }: ButtonProps) {
  const glyph = icon ? <Icon name={icon} size={ICON_SIZE[size]} /> : null;
  return (
    <button type={type} className={buttonClassName(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {iconPosition === 'start' && glyph}
      {children}
      {iconPosition === 'end' && glyph}
    </button>
  );
}

export interface ButtonLinkProps extends CommonProps, Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'href'> {
  href: string;
  /** 站外或需整页跳转时用原生 <a>。 */
  external?: boolean;
}

/** 看起来像按钮的导航链接：主入口（新建设计 / 打开豆社）等。 */
export function ButtonLink({ variant = 'secondary', size = 'md', icon, iconPosition = 'start', className, children, href, external = false, ...rest }: ButtonLinkProps) {
  const glyph = icon ? <Icon name={icon} size={ICON_SIZE[size]} /> : null;
  const content = <>{iconPosition === 'start' && glyph}{children}{iconPosition === 'end' && glyph}</>;
  const classes = buttonClassName(variant, size, className);
  if (external) return <a href={href} className={classes} {...rest}>{content}</a>;
  return <Link href={href} className={classes} {...rest}>{content}</Link>;
}
