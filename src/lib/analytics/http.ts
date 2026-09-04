import { analyticsQuerySchema } from './reports';

const FILTER_KEYS = [
  'start',
  'end',
  'eventName',
  'device',
  'browser',
  'os',
  'actor',
  'path',
  'referrer',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmContent',
] as const;

export function analyticsQueryFromUrl(url: string) {
  const search = new URL(url).searchParams;
  return analyticsQuerySchema.parse(Object.fromEntries(
    FILTER_KEYS.flatMap((key) => {
      const value = search.get(key);
      return value === null ? [] : [[key, value]];
    }),
  ));
}
