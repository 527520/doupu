'use client';

import { useEffect, useRef } from 'react';
import type { CommunityPreviewV1 } from '@/lib/community/snapshot';

export default function CommunityPreviewCanvas({ preview, label }: { preview: CommunityPreviewV1; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const scale = 4;
    canvas.width = preview.width * scale;
    canvas.height = preview.height * scale;
    context.clearRect(0, 0, canvas.width, canvas.height);
    preview.cells.forEach((hex, index) => {
      if (!hex) return;
      context.fillStyle = hex;
      context.fillRect((index % preview.width) * scale, Math.floor(index / preview.width) * scale, scale, scale);
    });
  }, [preview]);
  return <canvas ref={ref} role="img" aria-label={label} className="community-preview-canvas" />;
}
