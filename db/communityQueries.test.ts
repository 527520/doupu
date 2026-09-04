import { beforeEach, describe, expect, it } from 'vitest';
import { createTestClient, type TestDatabase } from './testClient';
import { communityRevisions, communityRevisionTags, communityTags, communityWorks, users } from './schema';
import { DEFAULT_GENERATION_PARAMS, type ProjectFile } from '@/lib/types';
import { COMMUNITY_LICENSE_VERSION, communitySnapshotFromProject, deriveCommunityPreview } from '@/lib/community/snapshot';
import { getPublicCommunityWork, listPublicCommunityWorks } from '@/lib/community/queries';

function source(): ProjectFile {
  return {
    format: 'doupu-project', version: 3, engineVersion: 'test', boardProfile: '5mm-29', name: 'private',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    paletteSelection: { palette: { kind: 'custom', colors: [{ hex: '#FF0000', code: 'R1' }] }, kitTier: 0 },
    params: { ...DEFAULT_GENERATION_PARAMS, targetWidth: 20, targetColorCount: 2 },
    pattern: { width: 2, height: 1, cells: [
      { hex: '#FF0000', code: 'R1', transparent: false },
      { hex: '#FF0000', code: 'R1', transparent: false },
    ] },
  };
}

describe('public community queries', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestClient();
  });

  it('paginates 24 at a time and never exposes internal identity in public DTOs', async () => {
    const publicAuthorId = crypto.randomUUID();
    const [author] = await db.insert(users).values({
      email: 'private@example.com', username: 'Alice', passwordHash: 'secret', emailVerifiedAt: new Date(), publicAuthorId,
    }).returning();
    const snapshot = communitySnapshotFromProject(source())!;
    const preview = deriveCommunityPreview(snapshot.pattern);
    const records = Array.from({ length: 25 }, (_, index) => ({
      workId: crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      publishedAt: new Date(Date.UTC(2026, 8, 1, index)),
      title: `作品 ${String(index).padStart(2, '0')}`,
    }));
    await db.insert(communityWorks).values(records.map((item, index) => ({
      id: item.workId,
      authorUserId: author.id,
      currentPublishedRevisionId: item.revisionId,
      likeCount: index,
      createdAt: item.publishedAt,
      updatedAt: item.publishedAt,
    })));
    await db.insert(communityRevisions).values(records.map((item) => ({
      id: item.revisionId,
      workId: item.workId,
      revisionNumber: 1,
      status: 'published' as const,
      title: item.title,
      authorType: 'user' as const,
      publicAuthorId,
      frozenDisplayName: 'Alice',
      licenseVersion: COMMUNITY_LICENSE_VERSION,
      licenseConfirmedAt: item.publishedAt,
      engineVersion: snapshot.engineVersion,
      boardProfile: snapshot.boardProfile,
      paletteKind: 'custom',
      width: snapshot.pattern.width,
      height: snapshot.pattern.height,
      colorCount: 1,
      snapshot,
      preview,
      publishedAt: item.publishedAt,
    })));
    const [tag] = await db.insert(communityTags).values({ name: '动物', slug: 'animals' }).returning();
    await db.insert(communityRevisionTags).values({ revisionId: records[24].revisionId, tagId: tag.id });

    const first = await listPublicCommunityWorks(db, { sort: 'latest' });
    expect(first.items).toHaveLength(24);
    expect(first.nextCursor).toBeTruthy();
    expect(first.items[0]).not.toHaveProperty('snapshot');
    const second = await listPublicCommunityWorks(db, { sort: 'latest', cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(25);

    const filtered = await listPublicCommunityWorks(db, { sort: 'latest', tag: 'animals', q: '24' });
    expect(filtered.items).toHaveLength(1);
    const detail = await getPublicCommunityWork(db, records[24].workId);
    expect(detail).toMatchObject({
      title: '作品 24',
      author: { authorType: 'user', publicAuthorId, displayName: 'Alice' },
      tags: [{ name: '动物', slug: 'animals' }],
    });
    const json = JSON.stringify(detail);
    expect(json).not.toContain(author.id);
    expect(json).not.toContain('private@example.com');
    expect(json).not.toContain('secret');
  });
});
