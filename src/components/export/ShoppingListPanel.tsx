'use client';

/**
 * 采购清单（F-3）：把「用量统计」变成能照着买的清单。
 *
 * 统计面板回答「这张图用了多少」，采购清单回答「我要买什么、买几包」——
 * 后者是竞品普遍具备而豆谱缺失的一环。清单只在屏幕上展示并支持一键复制文本；
 * 按 D6 决策不做 CSV 导出。
 */
import { useMemo, useRef, useState } from 'react';
import ColorBand from '@/components/palettes/ColorBand';
import Notice from '@/components/ui/Notice';
import { zhCN } from '@/messages/zh-CN';
import {
  DEFAULT_BEADS_PER_PACK,
  buildShoppingList,
  shoppingListText,
} from '@/lib/export/shoppingList';
import type { PatternStatsItem } from '@/lib/types';

interface Props {
  stats: readonly PatternStatsItem[];
  designName: string;
  width: number;
  height: number;
  expanded?: boolean;
}

export default function ShoppingListPanel({ stats, designName, width, height, expanded = false }: Props) {
  const t = zhCN.shopping;
  const [open, setOpen] = useState(expanded);
  const [packText, setPackText] = useState(String(DEFAULT_BEADS_PER_PACK));
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const [copiedText, setCopiedText] = useState('');
  const copying = useRef(false);

  const perPack = Number(packText);
  const validPack = Number.isSafeInteger(perPack) && perPack >= 1;
  const list = useMemo(
    () => buildShoppingList(stats, Number.isFinite(perPack) ? perPack : DEFAULT_BEADS_PER_PACK),
    [stats, perPack],
  );

  const text = shoppingListText(list, { designName, width, height });
  const copy = async (): Promise<void> => {
    if (!validPack || copying.current) return;
    copying.current = true;
    setCopiedText(text);
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setCopied('done');
    } catch {
      // 剪贴板在非 HTTPS 或权限受限时不可用：明确告诉用户「手动复制」，不假装成功
      setCopied('failed');
    } finally { copying.current = false; }
  };

  if (stats.length === 0) return null;

  return (
    <section aria-label={t.title} className="card-surface flex flex-col gap-2 p-3 text-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center justify-between gap-2 text-left font-medium text-ink"
      >
        <span>{t.title}</span>
        <span className="text-xs text-ink-soft">{open ? t.hide : t.show}</span>
      </button>
      <p className="text-xs text-ink-soft">{validPack ? t.summary(list.total, list.colors, list.packs, list.beadsPerPack) : `${list.total} 粒 · ${list.colors} 色`}</p>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => void copy()} disabled={!validPack} className="btn-outline btn-sm">{t.copy}</button>
        {copied === 'done' && copiedText === text && <span role="status" className="text-xs text-success">{t.copied}</span>}
      </div>
      {copied === 'failed' && copiedText === text && <><Notice kind="warning" compact>{t.copyFailed}</Notice><label className="text-xs text-ink-soft">手动复制材料清单<textarea readOnly value={text} rows={6} className="input-field w-full" onFocus={(event) => event.target.select()} /></label></>}

      {open && (
        <>
          <details className="shopping-pack-options"><summary>包装换算设置（每包 {validPack ? perPack : '—'} 粒）</summary><label className="flex items-center gap-2 text-xs text-ink-soft">
            {t.beadsPerPack}
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={packText}
              onChange={(event) => { setPackText(event.target.value); setCopied('idle'); }}
              className="w-20 input-compact px-1 py-0.5 text-xs"
              aria-label={t.beadsPerPack}
            />
          </label>
          <p className="text-xs text-ink-soft">{t.packHint}</p></details>
          {!validPack && <p role="alert" className="text-xs text-danger">每包颗数需要填写正整数。</p>}

          <ul tabIndex={0} aria-label="逐色材料用量" className="shopping-material-list flex max-h-56 flex-col gap-1 overflow-auto pr-1">
            {list.items.map((item) => (
              <li key={`${item.code}-${item.hex}`} className="flex items-center gap-2 text-xs">
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 shrink-0 rounded-sm border border-lilac/40"
                  style={{ backgroundColor: item.hex }}
                />
                <span className="w-14 shrink-0 font-mono text-ink">{item.code}</span>
                <span className="w-16 shrink-0 tabular-nums text-ink">{item.count} {zhCN.export.countUnit}</span>
                <span className="w-12 shrink-0 tabular-nums text-ink-soft">{item.share}%</span>
                <span className="ml-auto tabular-nums text-ink-soft">{validPack ? t.packs(item.packs) : '— 包'}</span>
              </li>
            ))}
          </ul>

          <ColorBand
            colors={list.items.map((item) => item.hex)}
            max={20}
            label={t.bandAria(list.colors)}
          />

        </>
      )}
    </section>
  );
}
