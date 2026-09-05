import { z } from 'zod';
import { getDb } from '@/lib/auth/db';
import { requireApiActor } from '@/lib/auth/dal';
import { okJson, withApiErrors } from '@/lib/auth/http';
import { inspectCommunityRevision } from '@/lib/community/queries';

async function get(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireApiActor('community:moderate');
  return okJson(await inspectCommunityRevision(getDb(), z.uuid().parse((await params).id)), { headers: { 'Cache-Control': 'private, no-store' } });
}
export const GET = withApiErrors(get);
