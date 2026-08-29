import Link from 'next/link';
import type { MouseEventHandler } from 'react';
import { zhCN } from '@/messages/zh-CN';

export default function Brand({ compact = false, onClick }: { compact?: boolean; onClick?: MouseEventHandler<HTMLAnchorElement> }) {
  return (
    <Link href="/" onClick={onClick} className={`brand-lockup${compact ? ' brand-lockup-compact' : ''}`} aria-label={zhCN.nav.home}>
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
      <span className="brand-type"><strong>{zhCN.app.name}</strong><small>{zhCN.workspace.brandEnglish}</small></span>
    </Link>
  );
}
