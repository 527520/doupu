import { asc, eq } from 'drizzle-orm';
import { communityTags } from '@/../db/schema';
import { getDb } from '@/lib/auth/db';
import { okJson, withApiErrors } from '@/lib/auth/http';

async function get() {
  const items = await getDb().select({ id: communityTags.id, name: communityTags.name, slug: communityTags.slug })
    .from(communityTags).where(eq(communityTags.active, true))
    .orderBy(asc(communityTags.sortOrder), asc(communityTags.name));
  return okJson({ items }, { headers: { 'Cache-Control': 'public, s-maxage=300' } });
}

export const GET = withApiErrors(get);
