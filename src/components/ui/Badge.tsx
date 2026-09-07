/**
 * 状态徽标（site-ui-overhaul 02）：小圆点 + 短文字。语气只表达状态类别，不表达品牌色。
 */
import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'progress' | 'ok' | 'warn' | 'danger' | 'featured';

export default function Badge({ tone = 'neutral', children, className = '', dot = true }: { tone?: BadgeTone; children: ReactNode; className?: string; dot?: boolean }) {
  return <span className={`badge${className ? ` ${className}` : ''}`} data-tone={tone}>{dot && <i aria-hidden="true" />}{children}</span>;
}
