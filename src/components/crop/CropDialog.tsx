'use client';

import { useSyncExternalStore } from 'react';
import Modal from '@/components/ui/Modal';
import Notice from '@/components/ui/Notice';
import { zhCN } from '@/messages/zh-CN';
import { ImageCropper, type ImageCropperProps } from './ImageCropper';

/**
 * 真正可见的视口（浏览器栏、软键盘、浏览器缩放都会改它）。
 *
 * 这里不用 useState + resize 监听：`visualViewport` 的高度更新与 resize 事件不保证
 * 同一时刻落定，先到的事件会读到旧值，而组件再收不到第二个事件——弹窗会永久停在
 * 旧尺寸（13-optional-recrop 手机用例实测：布局视口已 700，弹窗内联样式仍是
 * height: 400，`expect.poll` 5 秒都等不到）。改用订阅式读取 + 布局视口的
 * ResizeObserver：尺寸一变就重新取值，resize 事件后再补一帧，覆盖迟到的更新。
 */
const MIN_VIEWPORT = 1;

function readViewport(): string {
  const visual = typeof window === 'undefined' ? undefined : window.visualViewport;
  const layoutWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const layoutHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
  const width = Math.max(MIN_VIEWPORT, visual?.width && visual.width > 0 ? visual.width : layoutWidth);
  const height = Math.max(MIN_VIEWPORT, visual?.height && visual.height > 0 ? visual.height : layoutHeight);
  return `${width}:${height}:${visual?.offsetLeft ?? 0}:${visual?.offsetTop ?? 0}`;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const deferred = () => {
    // 先立即通知一次（事件通常已经带着新值），再补一帧：resize 事件可能早于
    // visualViewport 的新值，补读一次即可收敛。快照没变时 useSyncExternalStore
    // 会自行跳过，不会产生多余渲染。
    onChange();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(onChange);
  };
  window.visualViewport?.addEventListener('resize', deferred);
  window.visualViewport?.addEventListener('scroll', onChange);
  window.addEventListener('resize', deferred);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onChange);
  observer?.observe(document.documentElement);
  return () => {
    window.visualViewport?.removeEventListener('resize', deferred);
    window.visualViewport?.removeEventListener('scroll', onChange);
    window.removeEventListener('resize', deferred);
    observer?.disconnect();
  };
}

/** 浏览器栏、软键盘和浏览器缩放变化时，操作区跟随真正可见的视口。 */
export default function CropDialog({ error, ...props }: ImageCropperProps & { error?: string | null }) {
  const [width, height, left, top] = useSyncExternalStore(subscribe, readViewport, () => '1024:768:0:0')
    .split(':').map(Number);
  const gap = width >= 768 && height >= 500 ? 16 : 0;
  const panelWidth = Math.min(1000, width - gap * 2);
  const panelHeight = Math.min(900, height - gap * 2);
  return <Modal label={zhCN.crop.title} onClose={props.onCancel} panelClassName="crop-dialog" panelStyle={{
    position: 'fixed', width: panelWidth, height: panelHeight, maxWidth: panelWidth, maxHeight: panelHeight,
    left: left + (width - panelWidth) / 2,
    top: top + (height - panelHeight) / 2,
  }}>
    {error && <Notice kind="danger">{error}</Notice>}
    <ImageCropper {...props} fitViewport />
  </Modal>;
}
