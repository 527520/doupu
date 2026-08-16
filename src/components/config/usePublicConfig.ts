'use client';

/**
 * 客户端公开配置钩子（票 02）：挂载后从 /api/config 拉取服务端运行时值，
 * 拉取前/失败时使用内置回退（与历史默认一致）。
 * 用途：改 .env + 重启即生效，无需改代码重新发版。
 */
import { useEffect, useState } from 'react';
import { publicConfigFallback, type PublicConfig } from '@/lib/config';

export function usePublicConfig(): PublicConfig {
  const [cfg, setCfg] = useState<PublicConfig>(publicConfigFallback);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config', { method: 'GET' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setCfg(data as PublicConfig);
      })
      .catch(() => {
        // 拉取失败：保持回退默认，不打扰用户
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return cfg;
}
