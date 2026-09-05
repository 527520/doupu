'use client';
import { useSyncExternalStore, type CSSProperties } from 'react';

function subscribe(callback:()=>void) {
  window.visualViewport?.addEventListener('resize',callback);
  window.visualViewport?.addEventListener('scroll',callback);
  window.addEventListener('resize',callback);
  return ()=>{window.visualViewport?.removeEventListener('resize',callback);window.visualViewport?.removeEventListener('scroll',callback);window.removeEventListener('resize',callback);};
}
function snapshot() {
  const viewport=window.visualViewport;
  return `${viewport?.height??window.innerHeight}:${Math.max(0,window.innerHeight-(viewport?.height??window.innerHeight)-(viewport?.offsetTop??0))}`;
}
/** The keyboard may shrink the visual viewport without shrinking layout vh. */
export default function useVisualViewport(): CSSProperties {
  const [height,bottom]=useSyncExternalStore(subscribe,snapshot,()=> '0:0').split(':');
  return { '--sheet-height':Number(height)>0?`${height}px`:'100dvh','--sheet-bottom':`${bottom}px` } as CSSProperties;
}
