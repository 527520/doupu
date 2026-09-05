import { forbidden } from 'next/navigation';
import { z } from 'zod';
import WorksManager from '@/components/admin/WorksManager';
import { authorize } from '@/lib/auth/authorization';
import { getSessionActor } from '@/lib/auth/session';
import { zhCN } from '@/messages/zh-CN';

export default async function AdminWorksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!authorize(await getSessionActor(), 'community:moderate')) forbidden();
  const parsed = z.uuid().safeParse((await searchParams).work);
  const workId = parsed.success ? parsed.data : undefined;
  const t = zhCN.communityAdmin.pages.works;
  return <main id="main" className="admin-page"><header className="admin-page-header"><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.description}</p></header><WorksManager key={workId ?? 'all'} initialWorkId={workId} /></main>;
}
