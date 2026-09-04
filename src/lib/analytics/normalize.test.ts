import { describe, expect, it } from 'vitest';
import { normalizeAnalyticsContext } from './normalize';

describe('analytics privacy normalization', () => {
  it('drops query text, referrer paths, utm term and raw user agent', () => {
    const value = normalizeAnalyticsContext({
      path: '/community?q=私人搜索#section',
      referrer: 'https://search.example/path?q=private',
      utm: { source: ' News ', medium: 'email', campaign: 'launch', content: 'hero', term: 'private' },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1',
    });

    expect(value).toEqual({
      path: '/community',
      referrerDomain: 'search.example',
      utmSource: 'news',
      utmMedium: 'email',
      utmCampaign: 'launch',
      utmContent: 'hero',
      deviceType: 'mobile',
      browserFamily: 'safari',
      osFamily: 'ios',
    });
    expect(JSON.stringify(value)).not.toContain('私人搜索');
    expect(JSON.stringify(value)).not.toContain('Mozilla');
    expect(JSON.stringify(value)).not.toContain('private');
  });
});
