import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';

export default function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className={`brand-lockup${compact ? ' brand-lockup-compact' : ''}`} aria-label={zhCN.nav.home}>
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
      <span className="brand-type"><strong>{zhCN.app.name}</strong><small>DOUPU STUDIO</small></span>
    </Link>
  );
}
