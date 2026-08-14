'use client';

/** 编辑器工具栏（表现组件）：工具切换、画笔大小、撤销/重做、替换入口、清除。 */
import { zhCN } from '@/messages/zh-CN';
import type { BrushSize, ToolId } from '@/lib/editor/ops';

interface Props {
  tool: ToolId;
  brushSize: BrushSize;
  canUndo: boolean;
  canRedo: boolean;
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

  return (
    <div aria-label={t.title} className="flex flex-wrap items-center gap-2 text-sm">
      {tools.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={tool === id}
          title={TOOL_SHORTCUTS[id] ? `${label}（${TOOL_SHORTCUTS[id]}）` : label}
          onClick={() => onToolChange(id)}
          className={`rounded border px-2 py-1 ${tool === id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600'}`}
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
              className={`h-7 w-7 rounded border text-xs ${brushSize === size ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}
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
        className="rounded border border-gray-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t.undo}
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Ctrl+Shift+Z"
        className="rounded border border-gray-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t.redo}
      </button>

      <span className="mx-1 h-4 w-px bg-gray-300" />

      <button type="button" onClick={onReplaceOpen} className="rounded border border-gray-300 px-2 py-1 text-gray-600">
        {t.replace}
      </button>
      {replaceCountMessage && <span className="text-xs text-gray-500">{replaceCountMessage}</span>}
      <button type="button" onClick={onClear} className="rounded border border-red-200 px-2 py-1 text-red-600">
        {t.clear}
      </button>
    </div>
  );
}
