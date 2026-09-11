import { describe, expect, it } from 'vitest';
import { communityThumbnailUrl } from './thumbnailUrl';

describe('communityThumbnailUrl', () => {
  it('默认尺寸不加查询参数；large 才带 size', () => {
    expect(communityThumbnailUrl('rev-1')).toBe('/api/community/revisions/rev-1/thumbnail');
    expect(communityThumbnailUrl('rev-1', 'default')).toBe('/api/community/revisions/rev-1/thumbnail');
    expect(communityThumbnailUrl('rev-1', 'large')).toBe('/api/community/revisions/rev-1/thumbnail?size=large');
  });
});
