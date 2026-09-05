'use client';

import { ModalOverlay, Modal, Dialog, Heading, Button } from 'react-aria-components';
import { zhCN } from '@/messages/zh-CN';
import type { ReactNode } from 'react';
import useVisualViewport from './useVisualViewport';

export default function DetailPanel({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const viewportStyle=useVisualViewport();
  return <ModalOverlay style={viewportStyle} isOpen={open} onOpenChange={(next)=>{if(!next)onClose();}} isDismissable className="detail-panel-overlay">
    <Modal className="detail-panel"><Dialog className="detail-panel-dialog">
      <header><Heading slot="title">{title}</Heading><Button aria-label={zhCN.selection.close} onPress={onClose}>×</Button></header>
      <div className="detail-panel-content">{children}</div>
    </Dialog></Modal>
  </ModalOverlay>;
}
