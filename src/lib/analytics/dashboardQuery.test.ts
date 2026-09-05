import { describe, expect, it } from 'vitest';
import { resolveDashboardQuery } from './dashboardQuery';

const now = new Date('2026-09-05T04:00:00Z');
describe('analytics dashboard query recovery', () => {
  it.each(['2026-09-05T04:00:00Z', '2025-03-01T15:59:59Z'])('accepts the whole oldest retained Shanghai day at %s', (timestamp) => {
    const current = new Date(timestamp);
    const oldest = new Date(current.getTime() - 730 * 86400000 + 8 * 3600000).toISOString().slice(0, 10);
    expect(resolveDashboardQuery({ start: oldest, end: oldest }, current)).toMatchObject({ invalid: false, query: { start: oldest, end: oldest } });
    const expired = new Date(Date.parse(oldest) - 86400000).toISOString().slice(0, 10);
    expect(resolveDashboardQuery({ start: expired, end: oldest }, current).invalid).toBe(true);
  });
  it('marks invalid, expired and duplicate query values instead of silently presenting a different report', () => {
    for (const input of [{ start: 'invalid' }, { start: '2020-01-01' }, { start: '2026-09-06', end: '2026-09-01' }, { device: ['desktop', 'mobile'] }]) {
      const resolved = resolveDashboardQuery(input, now);
      expect(resolved.invalid).toBe(true);
      expect(resolved.query).toEqual({ start: '2026-08-07', end: '2026-09-05' });
    }
  });
  it('keeps supported precise filters and explicitly removes combinations in long ranges', () => {
    const precise = resolveDashboardQuery({ start: '2026-09-01', end: '2026-09-05', device: 'mobile', dimension: 'actor', funnel: 'communityReuse' }, now);
    expect(precise).toMatchObject({ invalid: false, filtersIgnored: false, dimension: 'actor', funnel: 'communityReuse', query: { device: 'mobile' } });
    const aggregate = resolveDashboardQuery({ start: '2026-04-01', end: '2026-09-05', device: 'mobile', eventName: 'page_viewed' }, now);
    expect(aggregate.filtersIgnored).toBe(true);
    expect(aggregate.query).toEqual({ start: '2026-04-01', end: '2026-09-05', eventName: 'page_viewed' });
  });
  it('marks invalid dimension and funnel choices while using defined defaults', () => {
    expect(resolveDashboardQuery({ dimension: 'private-user-id', funnel: 'invalid' }, now)).toMatchObject({ invalid: true, dimension: 'device', funnel: 'creation' });
  });
});
