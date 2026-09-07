/** 缩略图地址（浏览器与服务端共用，不依赖数据库模块）。 */
export function communityThumbnailUrl(revisionId: string, size: 'default' | 'large' = 'default'): string {
  return `/api/community/revisions/${revisionId}/thumbnail${size === 'large' ? '?size=large' : ''}`;
}
