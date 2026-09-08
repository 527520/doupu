'use client';

/**
 * 豆粒按钮（site-ui-overhaul 01 / ui-polish-2026）：纯图标操作的统一形态。
 *
 * 圆环像一颗还没上板的豆；hover 中心填色；`pressed` 时是软态（莓果软底 + 半透明莓果边 + 深莓果图标），
 * 像一颗被按进底板、透出底色的豆。图标本身没有文字，所以 `label` 必填并同时写入 aria-label 与 title。
 *
 * 落位动效只在用户切换后播放：首屏就是「已点赞」的按钮不应该在加载时弹一下。
 */
import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
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
  /** 状态尚未就绪（例如点赞状态还在请求中）：保持正常观感，只把图标降一点，避免灰亮闪动。 */
  loading?: boolean;
}

export default function IconButton({ icon, label, pressed, tone = 'neutral', size = 'md', settle = true, loading = false, className, type = 'button', ...rest }: IconButtonProps) {
  const previous = useRef(pressed);
  const [motion, setMotion] = useState<'none' | 'pressed' | 'released'>('none');
  useEffect(() => {
    if (previous.current === pressed) return;
    previous.current = pressed;
    setMotion(pressed ? 'pressed' : 'released');
  }, [pressed]);
  const classes = ['btn-bead', size === 'sm' ? 'btn-bead-sm' : '', settle && motion !== 'none' ? 'btn-bead-settle' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} aria-label={label} title={label} aria-pressed={pressed} data-tone={tone === 'neutral' ? undefined : tone}
      data-released={motion === 'released' || undefined} data-loading={loading || undefined} {...rest}>
      <Icon name={icon} size={size === 'sm' ? 16 : 18} />
    </button>
  );
}
