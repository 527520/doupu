'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { track } from '@/lib/analytics/client';
import { zhCN } from '@/messages/zh-CN';

export default function CommunityMineActions({ workId, version }: { workId: string; version: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const withdraw = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/community/works/${workId}/withdraw`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: version }),
      });
      if (response.ok) {
        track({ name: 'community_submission_withdrawn', properties: {} });
        router.refresh();
      }
    } finally { setBusy(false); }
  };
  return <button type="button" className="btn-danger-outline btn-xs" disabled={busy} onClick={() => void withdraw()}>{busy ? zhCN.communityAdmin.mine.withdrawing : zhCN.communityAdmin.mine.withdraw}</button>;
}
