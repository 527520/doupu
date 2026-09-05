'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Notice from '@/components/ui/Notice';
import { zhCN } from '@/messages/zh-CN';
import { ImageCropper, type ImageCropperProps } from './ImageCropper';

function viewport() {
  const view = typeof window === 'undefined' ? null : window.visualViewport;
  return {
    width: view?.width ?? (typeof window === 'undefined' ? 1024 : window.innerWidth),
    height: view?.height ?? (typeof window === 'undefined' ? 768 : window.innerHeight),
    left: view?.offsetLeft ?? 0,
    top: view?.offsetTop ?? 0,
  };
}

/** 浏览器栏、软键盘和浏览器缩放变化时，操作区跟随真正可见的视口。 */
export default function CropDialog({ error, ...props }: ImageCropperProps & { error?: string | null }) {
  const [view, setView] = useState(viewport);
  useEffect(() => {
    const update = () => setView(viewport());
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);
  const gap = view.width >= 768 && view.height >= 500 ? 16 : 0;
  const width = Math.min(1000, view.width - gap * 2);
  const height = Math.min(900, view.height - gap * 2);
  return <Modal label={zhCN.crop.title} onClose={props.onCancel} panelClassName="crop-dialog" panelStyle={{
    position: 'fixed', width, height, maxWidth: width, maxHeight: height,
    left: view.left + (view.width - width) / 2,
    top: view.top + (view.height - height) / 2,
  }}>
    {error && <Notice kind="danger">{error}</Notice>}
    <ImageCropper {...props} fitViewport />
  </Modal>;
}
