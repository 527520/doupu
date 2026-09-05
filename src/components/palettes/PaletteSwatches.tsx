'use client';

/**
 * 可展开的色板色格（E-1）。
 *
 * 色板管理页原来只有「291 色」这个数字。全铺 291 个色块会把页面撑得很长，
 * 因此默认折叠成一条色带，点开才铺满色格——概览与细看两种需求各得其所。
 * 色格带色号 title/aria-label，方便对照采购。
 */
import { useId, useState, type CSSProperties } from 'react';
import ColorBand from './ColorBand';
import { zhCN } from '@/messages/zh-CN';
import type { BuiltinPaletteExclusionReason } from '@/lib/palettes';
import type { PaletteColor } from '@/lib/types';

export interface PaletteSwatchColor extends PaletteColor {
  excludedReason?: BuiltinPaletteExclusionReason;
  group?: string | null;
  sourceId?: string | null;
}

interface Props {
  /** 色板名（用于色带的可访问名） */
  name: string;
  colors: readonly PaletteSwatchColor[];
}

function exclusionLabel(reason: BuiltinPaletteExclusionReason): string {
  const t = zhCN.palettes;
  switch (reason) {
    case 'transparent': return t.transparentMaterial;
    case 'unidentified': return t.unidentifiedCode;
    case 'duplicate-hex': return t.duplicateColor;
    case 'unavailable-code': return t.unavailableCode;
  }
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
          tabIndex={0}
          aria-label={`${name} 色号列表`}
          /* 限高 + 滚动：大色板铺开不应把整页拉长。 */
          className="palette-swatch-grid"
        >
          {colors.map((color, index) => {
            const reason = color.excludedReason ?? null;
            const transparent = reason === 'transparent';
            const codeLabel = reason === 'unidentified'
              ? t.unidentifiedCode
              : color.code ?? t.unavailableCode;
            const detail = reason && reason !== 'unidentified' && reason !== 'unavailable-code'
              ? exclusionLabel(reason)
              : null;
            const accessibleLabel = [codeLabel, color.hex, reason ? t.displayOnly : null, detail]
              .filter(Boolean)
              .join(' ');
            const swatchStyle = transparent
              ? ({ '--palette-swatch-color': color.hex } as CSSProperties)
              : { backgroundColor: color.hex };
            return (
              <li
                key={`${color.code ?? ''}-${color.hex}-${index}`}
                title={accessibleLabel}
                aria-label={accessibleLabel}
                className="palette-swatch-item"
              >
                <span
                  aria-hidden="true"
                  className={`palette-swatch-chip${transparent ? ' palette-swatch-transparent' : ''}`}
                  style={swatchStyle}
                />
                <span className="palette-swatch-code">{codeLabel}</span>
                <span className="palette-swatch-hex">{color.hex}</span>
                {reason && (
                  <span className="palette-swatch-exclusion">
                    <span>{t.displayOnly}</span>
                    {detail && <span>{detail}</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
