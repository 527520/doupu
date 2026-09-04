import { forbidden } from 'next/navigation';
import OfficialBatchStudio from '@/components/admin/OfficialBatchStudio';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';

export default async function AdminBatchesPage() {
  if (!authorize(await getSessionActor(), 'official:manage')) forbidden();
  return <main className="admin-page"><header className="admin-page-header"><span>06 / OFFICIAL PRODUCTION</span><h1>官方批量生产</h1><p>最多两个独立 Worker；低并发设备自动降为一个。成功项立即保存，刷新后只恢复已保存草稿。</p></header><OfficialBatchStudio /></main>;
}
