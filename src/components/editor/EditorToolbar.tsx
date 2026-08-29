'use client';

/** 编辑器工具栏（表现组件）：当前颜色指示、工具切换、画笔大小、撤销/重做、替换入口、镜像旋转、清除。 */
import { zhCN } from '@/messages/zh-CN';
import type { BrushSize, ToolId, TransformOp } from '@/lib/editor/ops';
import type { PaletteColor } from '@/lib/types';

interface Props {
  tool: ToolId;
  brushSize: BrushSize;
  canUndo: boolean;
  canRedo: boolean;
  /** 当前画笔颜色（橡皮等工具下显示对应状态） */
  currentColor?: PaletteColor | null;
  replaceCountMessage?: string | null;
  onToolChange: (tool: ToolId) => void;
  onBrushSizeChange: (size: BrushSize) => void;
  onUndo: () => void;
  onRedo: () => void;
  onReplaceOpen: () => void;
  onClear: () => void;
  /** 镜像/旋转（优化票 09） */
  onTransform: (op: TransformOp) => void;
}

const TOOL_SHORTCUTS: Record<ToolId, string> = {
  brush: 'B',
  eraser: 'E',
  fill: 'G',
  pick: 'I',
  replace: '',
  clear: '',
  transform: '',
};

export default function EditorToolbar({
  tool,
  brushSize,
  canUndo,
  canRedo,
  currentColor,
  replaceCountMessage,
  onToolChange,
  onBrushSizeChange,
  onUndo,
  onRedo,
  onReplaceOpen,
  onClear,
  onTransform,
}: Props) {
  const t = zhCN.editor;
  const tools: Array<{ id: ToolId; label: string }> = [
    { id: 'brush', label: t.brush },
    { id: 'eraser', label: t.eraser },
    { id: 'fill', label: t.fill },
    { id: 'pick', label: t.pick },
  ];

  const colorIndicator =
    tool === 'eraser' || tool === 'clear'
      ? { swatch: 'transparent', label: t.eraser }
      : currentColor
        ? { swatch: currentColor.hex, label: currentColor.code ?? currentColor.hex }
        : { swatch: '#d1d5db', label: t.noColor };

  return (
    <div aria-label={t.title} className="editor-tool-ribbon flex flex-wrap items-center gap-2 text-sm">
      {/* 当前颜色指示（spec 用户体验：始终可见当前将落笔的颜色） */}
      <span
        role="status"
        aria-label={`${t.currentColor}: ${colorIndicator.label}`}
        className="editor-current-swatch flex items-center gap-1.5 border border-lilac/50 bg-white px-2 py-1"
      >
        <span
          className="inline-block h-4 w-4 rounded-sm border border-lilac/60"
          style={
            colorIndicator.swatch === 'transparent'
              ? { background: 'repeating-conic-gradient(#d1d5db 0% 25%, #ffffff 0% 50%) 50% / 8px 8px' }
              : { backgroundColor: colorIndicator.swatch }
          }
        />
        <span className="font-mono text-xs text-ink">{colorIndicator.label}</span>
      </span>

      {tools.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={tool === id}
          title={TOOL_SHORTCUTS[id] ? `${label}（${TOOL_SHORTCUTS[id]}）` : label}
          onClick={() => onToolChange(id)}
          className={`editor-tool-button${tool === id ? ' is-active' : ''}`}
        >
          {label}
        </button>
      ))}

      {tool === 'brush' && (
        <div className="flex items-center gap-1.5" aria-label={t.brushSize}>
          {/* 可见组名：画笔大小（1=单格、2=2×2、3=3×3） */}
          <span className="text-xs text-ink-soft">{t.brushSize}</span>
          {([1, 2, 3] as BrushSize[]).map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={brushSize === size}
              aria-label={`${t.brushSize} ${size}×${size}`}
              title={`${t.brushSize} ${size}×${size}`}
              onClick={() => onBrushSizeChange(size)}
              className={`h-7 min-w-7 rounded-lg border px-1.5 text-xs transition-colors ${brushSize === size ? 'border-primary bg-primary text-white' : 'border-lilac/50 hover:bg-lilac-soft'}`}
            >
              {size}×{size}
            </button>
          ))}
        </div>
      )}

      <span className="mx-1 hidden h-4 w-px bg-lilac/40 sm:inline" />

      {/*
        D-8：350px 上这条工具条有 14 个控件，触屏还要 44px 触控目标，必然折行。
        与其让它折成散乱的 6 行，不如显式分组（撤销/重做、替换、变换、清空），
        组内不换行、组间换行——折行后每一行仍是一个可理解的功能组。
      */}
      <span className="flex items-center gap-1" aria-label={t.historyGroup}>
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Ctrl+Z"
          className="btn-tool"
        >
          {t.undo}
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Ctrl+Shift+Z"
          className="btn-tool"
        >
          {t.redo}
        </button>
      </span>

      <span className="mx-1 hidden h-4 w-px bg-lilac/40 sm:inline" />

      <span className="flex items-center gap-1">
        <button type="button" onClick={onReplaceOpen} className="btn-tool">
          {t.replace}
        </button>
        {replaceCountMessage && <span className="text-xs text-ink-soft">{replaceCountMessage}</span>}
      </span>

      <span className="flex items-center gap-1" aria-label={t.transformGroup}>
        <button type="button" onClick={() => onTransform('mirrorH')} title={t.mirrorH} className="btn-tool">
          ⇋
        </button>
        <button type="button" onClick={() => onTransform('mirrorV')} title={t.mirrorV} className="btn-tool">
          ⇵
        </button>
        <button type="button" onClick={() => onTransform('rotateCCW')} title={t.rotateCCW} className="btn-tool">
          ↺
        </button>
        <button type="button" onClick={() => onTransform('rotateCW')} title={t.rotateCW} className="btn-tool">
          ↻
        </button>
      </span>

      <button type="button" onClick={onClear} title={t.clearTitle} className="btn-danger-outline btn-xs">
        {t.clear}
      </button>
    </div>
  );
}
