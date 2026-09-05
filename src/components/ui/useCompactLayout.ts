'use client';
import { useSyncExternalStore } from 'react';

function subscribe(listener: () => void) {
  const media = window.matchMedia('(max-width: 767px)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
export default function useCompactLayout() {
  return useSyncExternalStore(subscribe, () => window.matchMedia('(max-width: 767px)').matches, () => false);
}
