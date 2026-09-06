/** 豆社按标签筛选的链接：以名称为筛选键，用户看到的地址就是标签本身。 */
export function communityTagHref(name: string): string {
  return `/community?tag=${encodeURIComponent(name)}`;
}
