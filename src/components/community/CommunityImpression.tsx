'use client';

import { useEffect } from 'react';
import { track } from '@/lib/analytics/client';

export function CommunityListImpression({ sort }: { sort: 'latest' | 'featured' | 'popular' }) {
  useEffect(() => { track({ name: 'community_list_viewed', properties: { sort } }); }, [sort]);
  return null;
}

export function CommunityDetailImpression() {
  useEffect(() => { track({ name: 'community_detail_viewed', properties: {} }); }, []);
  return null;
}
