'use client';

import Icon from '@/components/ui/Icon';
import { zhCN } from '@/messages/zh-CN';
import type { BrushSize, ToolId, TransformOp } from '@/lib/editor/ops';
import type { PaletteColor } from '@/lib/types';

interface Props {
  tool: ToolId;
  brushSize: BrushSize;
  canUndo: boolean;
  canRedo: boolean;
  currentColor?: PaletteColor | null;
  replaceCountMessage?: string | null;
  interactionMode?: 'pan' | 'edit';
  layout?: 'desktop' | 'mobile';
  moreOpen?: boolean;
  onPanMode?: () => void;
  onMoreToggle?: () => void;
  onToolChange: (tool: ToolId) => void;
  onBrushSizeChange: (size: BrushSize) => void;
  onUndo: () => void;
  onRedo: () => void;
  onReplaceOpen: () => void;
  onClear: () => void;
  onTransform: (op: TransformOp) => void;
}

const TOOL_SHORTCUTS: Partial<Record<ToolId, string>> = {
  brush: 'B',
  eraser: 'E',
  fill: 'G',
  pick: 'I',
};

export default function EditorToolbar({
  tool,
  brushSize,
  canUndo,
  canRedo,
  currentColor,
  replaceCountMessage,
  interactionMode = 'edit',
  layout = 'desktop',
  moreOpen = false,
  onPanMode = () => undefined,
  onMoreToggle = () => undefined,
  onToolChange,
  onBrushSizeChange,
  onUndo,
  onRedo,
  onReplaceOpen,
  onClear,
  onTransform,
}: Props) {
  const t = zhCN.editor;
  const colorIndicator = tool === 'eraser'
    ? { swatch: 'transparent', label: t.eraser }
    : currentColor
      ? { swatch: currentColor.hex, label: currentColor.code ?? currentColor.hex }
      : { swatch: '#d1d5db', label: t.noColor };
  const secondaryOpen = layout === 'desktop' || moreOpen;

  return (
    <div aria-label={t.title} className="editor-tool-ribbon">
      <div className="editor-action-dock">
        <span
          className="sr-only"
          role="status"
          aria-label={`${t.currentColor}: ${colorIndicator.label}`}
        />
        <button type="button" aria-pressed={interactionMode === 'pan'} onClick={onPanMode} title={`${t.panMode}（H）`}>
          <Icon name="hand" size={18} />
          <span>{t.panMode}</span>
        </button>
        <button
          type="button"
          aria-pressed={interactionMode === 'edit' && tool === 'brush'}
          onClick={() => onToolChange('brush')}
          title={`${t.brush}（B）`}
        >
          <Icon name="brush" size={18} />
          <span>{t.brush}</span>
        </button>
        <button
          type="button"
          aria-pressed={interactionMode === 'edit' && tool === 'eraser'}
          onClick={() => onToolChange('eraser')}
          title={`${t.eraser}（E）`}
        >
          <Icon name="eraser" size={18} />
          <span>{t.eraser}</span>
        </button>
        <button
          type="button"
          aria-label={t.chooseCurrentColor}
          title={`${t.currentColor}: ${colorIndicator.label}`}
          onClick={onMoreToggle}
          className="editor-current-swatch"
        >
          <span
            aria-hidden="true"
            className="inline-block h-5 w-5 rounded-sm border border-lilac/60"
            style={colorIndicator.swatch === 'transparent'
              ? { background: 'repeating-conic-gradient(#d1d5db 0% 25%, #ffffff 0% 50%) 50% / 8px 8px' }
              : { backgroundColor: colorIndicator.swatch }}
          />
          <span>{colorIndicator.label}</span>
        </button>
        <button type="button" onClick={onUndo} disabled={!canUndo} title="Ctrl+Z" aria-label={t.undo}>
          <Icon name="undo" size={18} />
          <span>{t.undo}</span>
        </button>
        <button type="button" onClick={onRedo} disabled={!canRedo} title="Ctrl+Shift+Z" aria-label={t.redo}>
          <Icon name="redo" size={18} />
          <span>{t.redo}</span>
        </button>
        <button type="button" onClick={onMoreToggle} aria-expanded={secondaryOpen} aria-label={t.moreTools}>
          <Icon name="more" size={18} />
          <span>{t.moreTools}</span>
        </button>
      </div>

      <div className={`editor-more-drawer${secondaryOpen ? ' is-open' : ''}`}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {([
            ['fill', t.fill],
            ['pick', t.pick],
          ] as Array<[ToolId, string]>).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={interactionMode === 'edit' && tool === id}
              title={`${label}（${TOOL_SHORTCUTS[id]}）`}
              onClick={() => onToolChange(id)}
              className={`editor-tool-button${interactionMode === 'edit' && tool === id ? ' is-active' : ''}`}
            >
              {label}
            </button>
          ))}

          {tool === 'brush' && <span className="flex items-center gap-1.5" aria-label={t.brushSize}>
            <span className="text-xs text-ink-soft">{t.brushSize}</span>
            {([1, 2, 3] as BrushSize[]).map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={brushSize === size}
                aria-label={`${t.brushSize} ${size}×${size}`}
                onClick={() => onBrushSizeChange(size)}
                className={`editor-tool-button${brushSize === size ? ' is-active' : ''}`}
              >
                {size}×{size}
              </button>
            ))}
          </span>}

          <button type="button" onClick={onReplaceOpen} className="btn-tool">{t.replace}</button>
          {replaceCountMessage && <span className="text-xs text-ink-soft">{replaceCountMessage}</span>}

          <span className="flex items-center gap-1" aria-label={t.transformGroup}>
            <button type="button" onClick={() => onTransform('mirrorH')} title={t.mirrorH} className="btn-tool">⇋</button>
            <button type="button" onClick={() => onTransform('mirrorV')} title={t.mirrorV} className="btn-tool">⇵</button>
            <button type="button" onClick={() => onTransform('rotateCCW')} title={t.rotateCCW} className="btn-tool">↺</button>
            <button type="button" onClick={() => onTransform('rotateCW')} title={t.rotateCW} className="btn-tool">↻</button>
          </span>

          <button type="button" onClick={onClear} title={t.clearTitle} className="btn-danger-outline btn-xs">{t.clear}</button>
        </div>
      </div>
    </div>
  );
}
