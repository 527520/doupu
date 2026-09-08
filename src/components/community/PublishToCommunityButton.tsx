'use client';

/**
 * 工作台「公开到豆社」（D49）。
 *
 * 公开作品必须附带原图，而完整原图只活在工作台的解码会话里：这里先把设计保存并
 * 推到云端，再把会话原图放进一次性交接库，最后跳转投稿页由用户确认上传条款。
 * 没有会话原图（例如刷新后恢复的设计）时照样可以进入投稿页，那里会要求重新选择原图。
 */
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ImageType } from '@/lib/image/sniff';
import { putPendingOriginal } from '@/lib/storage/pendingOriginals';
import { zhCN } from '@/messages/zh-CN';
import Button from '@/components/ui/Button';
import Notice from '@/components/ui/Notice';

interface Props {
  designId: string;
  /** 保存并同步到云端；返回 false 表示失败，不跳转。 */
  onBeforePublish?: () => Promise<boolean>;
  /** 当前会话原图（可能为空）。 */
  getOriginal: () => { bytes: Uint8Array; type: ImageType; name: string } | null;
  disabled?: boolean;
  disabledReason?: string;
}

export default function PublishToCommunityButton({ designId, onBeforePublish, getOriginal, disabled, disabledReason }: Props) {
  const t = zhCN.publish;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = useCallback(async (): Promise<void> => {
    setBusy(true); setError(null);
    try {
      if (onBeforePublish && !(await onBeforePublish())) { setError(t.notSynced); return; }
      const original = getOriginal();
      if (original) {
        try {
          await putPendingOriginal({ designId, bytes: original.bytes.slice().buffer as ArrayBuffer, type: original.type, name: original.name });
        } catch {
          // 交接失败只影响便捷性：投稿页会要求重新选择原图。
        }
      }
      router.push(`/community/submit?designId=${encodeURIComponent(designId)}`);
    } finally {
      setBusy(false);
    }
  }, [designId, getOriginal, onBeforePublish, router, t.notSynced]);

  return (
    <div className="publish-community">
      <Button variant="secondary" size="sm" icon="send" disabled={disabled || busy} loading={busy} title={disabled ? disabledReason : undefined} onClick={() => void publish()}>
        {busy ? t.preparing : t.button}
      </Button>
      {error && <Notice kind="danger" compact>{error}</Notice>}
    </div>
  );
}
