'use client';

/** 编辑器工具栏（表现组件）：当前颜色指示、工具切换、画笔大小、撤销/重做、替换入口、清除。 */
import { zhCN } from '@/messages/zh-CN';
import type { BrushSize, ToolId } from '@/lib/editor/ops';
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
}

const TOOL_SHORTCUTS: Record<ToolId, string> = {
  brush: 'B',
  eraser: 'E',
  fill: 'G',
  pick: 'I',
  replace: '',
  clear: '',
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
    <div aria-label={t.title} className="flex flex-wrap items-center gap-2 text-sm">
      {/* 当前颜色指示（spec 用户体验：始终可见当前将落笔的颜色） */}
      <span
        role="status"
        aria-label={`${t.currentColor}: ${colorIndicator.label}`}
        className="flex items-center gap-1.5 rounded border border-gray-300 bg-white px-2 py-1"
      >
        <span
          className="inline-block h-4 w-4 rounded-sm border border-gray-400"
          style={
            colorIndicator.swatch === 'transparent'
              ? { background: 'repeating-conic-gradient(#d1d5db 0% 25%, #ffffff 0% 50%) 50% / 8px 8px' }
              : { backgroundColor: colorIndicator.swatch }
          }
        />
        <span className="font-mono text-xs text-gray-700">{colorIndicator.label}</span>
      </span>

      {tools.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={tool === id}
          title={TOOL_SHORTCUTS[id] ? `${label}（${TOOL_SHORTCUTS[id]}）` : label}
          onClick={() => onToolChange(id)}
          className={`rounded border px-2 py-1 ${tool === id ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
        >
          {label}
        </button>
      ))}

      {tool === 'brush' && (
        <div className="flex items-center gap-1" aria-label={t.brushSize}>
          {([1, 2, 3] as BrushSize[]).map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={brushSize === size}
              onClick={() => onBrushSizeChange(size)}
              className={`h-7 w-7 rounded border text-xs ${brushSize === size ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 hover:bg-gray-50'}`}
            >
              {size}
            </button>
          ))}
        </div>
      )}

      <span className="mx-1 h-4 w-px bg-gray-300" />

      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title="Ctrl+Z"
        className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
      >
        {t.undo}
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Ctrl+Shift+Z"
        className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
      >
        {t.redo}
      </button>

      <span className="mx-1 h-4 w-px bg-gray-300" />

      <button type="button" onClick={onReplaceOpen} className="rounded border border-gray-300 px-2 py-1 text-gray-600 hover:bg-gray-50">
        {t.replace}
      </button>
      {replaceCountMessage && <span className="text-xs text-gray-500">{replaceCountMessage}</span>}
      <button type="button" onClick={onClear} title={t.clearTitle} className="rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50">
        {t.clear}
      </button>
    </div>
  );
}
