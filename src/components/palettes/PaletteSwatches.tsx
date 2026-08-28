'use client';

/**
 * 可展开的色板色格（E-1）。
 *
 * 色板管理页原来只有「291 色」这个数字。全铺 291 个色块会把页面撑得很长，
 * 因此默认折叠成一条色带，点开才铺满色格——概览与细看两种需求各得其所。
 * 色格带色号 title/aria-label，方便对照采购。
 */
import { useId, useState } from 'react';
import ColorBand from './ColorBand';
import { zhCN } from '@/messages/zh-CN';
import type { PaletteColor } from '@/lib/types';

interface Props {
  /** 色板名（用于色带的可访问名） */
  name: string;
  colors: readonly PaletteColor[];
}

export default function PaletteSwatches({ name, colors }: Props) {
  const t = zhCN.palettes;
  const [open, setOpen] = useState(false);
  const gridId = useId();
  const hexes = colors.map((color) => color.hex);

  return (
    <div className="flex flex-col gap-2">
      <ColorBand colors={hexes} label={t.bandAria(name, colors.length)} />
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={gridId}
        className="link-soft self-start text-xs"
      >
        {open ? t.hideColors : t.showColors}
      </button>
      {open && (
        <ul
          id={gridId}
          /* 限高 + 滚动：291 色铺开会把卡片撑到几千像素高，同排卡片也被拉长。 */
          className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(1.25rem,1fr))] gap-1 overflow-auto pr-1"
        >
          {colors.map((color) => (
            <li
              key={`${color.code ?? ''}-${color.hex}`}
              title={`${color.code ?? ''} ${color.hex}`.trim()}
              aria-label={`${color.code ?? ''} ${color.hex}`.trim()}
              className="aspect-square rounded-sm border border-lilac/30"
              style={{ backgroundColor: color.hex }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
