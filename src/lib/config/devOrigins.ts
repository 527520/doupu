export interface DevNetworkAddress {
  address: string;
  family: string | number;
  internal: boolean;
}

export type DevNetworkInterfaces = Record<string, readonly DevNetworkAddress[] | undefined>;

/**
 * Next.js 会拒绝未列入 allowedDevOrigins 的开发资源请求。开发服务器默认监听
 * 所有网卡，因此把当前机器实际拥有的非回环 IPv4 地址一并放行，手机通过同一
 * 局域网访问 `next dev` 时才能完整加载客户端脚本。
 */
export function collectAllowedDevOrigins(
  explicitOrigin: string | undefined,
  interfaces: DevNetworkInterfaces,
): string[] {
  const origins = new Set<string>(['127.0.0.1']);
  const explicit = explicitOrigin?.trim();
  if (explicit) origins.add(explicit);

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (!address.internal && address.family === 'IPv4') origins.add(address.address);
    }
  }

  return [...origins];
}
