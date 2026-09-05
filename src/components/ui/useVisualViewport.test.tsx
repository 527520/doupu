// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import useVisualViewport from './useVisualViewport';
afterEach(()=>vi.unstubAllGlobals());
it('软键盘只缩小可视视口时更新面板可用高度和底部避让',()=>{
  const viewport=Object.assign(new EventTarget(),{height:844,offsetTop:0});
  vi.stubGlobal('innerHeight',844);vi.stubGlobal('visualViewport',viewport);
  const {result,unmount}=renderHook(useVisualViewport);
  expect(result.current).toMatchObject({'--sheet-height':'844px','--sheet-bottom':'0px'});
  act(()=>{viewport.height=400;viewport.offsetTop=20;viewport.dispatchEvent(new Event('resize'));});
  expect(result.current).toMatchObject({'--sheet-height':'400px','--sheet-bottom':'424px'});
  unmount();
});
