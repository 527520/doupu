export type AnalyticsDeviceType = 'desktop' | 'mobile' | 'tablet' | 'other';
export type AnalyticsBrowserFamily = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';
export type AnalyticsOsFamily = 'android' | 'ios' | 'linux' | 'macos' | 'windows' | 'other';

interface RawAnalyticsContext {
  path?: string;
  referrer?: string;
  utm?: Record<string, unknown>;
  userAgent?: string | null;
}

export interface NormalizedAnalyticsContext {
  path: string;
  referrerDomain?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  deviceType: AnalyticsDeviceType;
  browserFamily: AnalyticsBrowserFamily;
  osFamily: AnalyticsOsFamily;
}

function safeValue(value: unknown, lowercase = false): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 100);
  if (!trimmed) return undefined;
  return lowercase ? trimmed.toLowerCase() : trimmed;
}

export function normalizePath(value: string | undefined): string {
  if (!value) return '/';
  try {
    const url = new URL(value, 'https://doupu.invalid');
    const rawPath = url.pathname.replace(/\/{2,}/gu, '/');
    const path = (/^\/s\/[^/]+\/?$/u.test(rawPath) ? '/s/[token]' : rawPath).slice(0, 300);
    return path.startsWith('/') ? path : '/';
  } catch {
    return '/';
  }
}

export function normalizeReferrerDomain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.hostname.toLowerCase().slice(0, 253)
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseUserAgent(userAgent: string | null | undefined): Pick<
  NormalizedAnalyticsContext,
  'deviceType' | 'browserFamily' | 'osFamily'
> {
  const ua = userAgent ?? '';
  const deviceType: AnalyticsDeviceType = /ipad|tablet|android(?!.*mobile)/iu.test(ua)
    ? 'tablet'
    : /iphone|ipod|android.*mobile|mobile/iu.test(ua)
      ? 'mobile'
      : ua ? 'desktop' : 'other';
  const browserFamily: AnalyticsBrowserFamily = /edg(?:e|a|ios)?\//iu.test(ua)
    ? 'edge'
    : /firefox|fxios/iu.test(ua)
      ? 'firefox'
      : /chrome|crios/iu.test(ua)
        ? 'chrome'
        : /safari/iu.test(ua)
          ? 'safari' : 'other';
  const osFamily: AnalyticsOsFamily = /iphone|ipad|ipod/iu.test(ua)
    ? 'ios'
    : /android/iu.test(ua)
      ? 'android'
      : /windows/iu.test(ua)
        ? 'windows'
        : /mac os x|macintosh/iu.test(ua)
          ? 'macos'
          : /linux/iu.test(ua)
            ? 'linux' : 'other';
  return { deviceType, browserFamily, osFamily };
}

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  return /bot|crawler|spider|slurp|headless|preview/iu.test(userAgent ?? '');
}

export function normalizeAnalyticsContext(input: RawAnalyticsContext): NormalizedAnalyticsContext {
  const device = parseUserAgent(input.userAgent);
  const output: NormalizedAnalyticsContext = {
    path: normalizePath(input.path),
    ...device,
  };
  const referrerDomain = normalizeReferrerDomain(input.referrer);
  if (referrerDomain) output.referrerDomain = referrerDomain;
  const source = safeValue(input.utm?.source, true);
  const medium = safeValue(input.utm?.medium, true);
  const campaign = safeValue(input.utm?.campaign);
  const content = safeValue(input.utm?.content);
  if (source) output.utmSource = source;
  if (medium) output.utmMedium = medium;
  if (campaign) output.utmCampaign = campaign;
  if (content) output.utmContent = content;
  return output;
}
