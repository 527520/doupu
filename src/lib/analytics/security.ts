import { createHmac } from 'node:crypto';

export function analyticsIpRateKey(ip: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = env.ANALYTICS_IP_HMAC_KEY
    ?? (env.NODE_ENV === 'production' ? '' : 'doupu-local-analytics-hmac-key-not-for-production');
  if (key.length < 32) throw new Error('ANALYTICS_IP_HMAC_KEY is not configured');
  const digest = createHmac('sha256', key).update(ip).digest('hex').slice(0, 24);
  return `analytics:ingest:${digest}`;
}
