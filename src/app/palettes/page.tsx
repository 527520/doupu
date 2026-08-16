'use client';

/** 色板管理页（spec §F6）：内置五套只读展示 + 自定义色板 CRUD。 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';
import { BRANDS, buildBrandPalette } from '@/lib/palettes';
import PaletteEditor from '@/components/palettes/PaletteEditor';
import Modal from '@/components/ui/Modal';
import {
  deletePalette,
  listPalettes,
  newPaletteId,
  savePalette,
  type PaletteRecord,
} from '@/components/palettes/api';

interface EditingState {
  id: string;
  name: string;
  colors: PaletteRecord['colors'];
}

export default function PalettesPage() {
  const t = zhCN.palettes;
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<PaletteRecord[]>([]);
  const [loginRequired, setLoginRequired] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setPageError(null);
    try {
      const list = await listPalettes();
      setRecords(list);
      setLoginRequired(false);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'UNAUTHORIZED') {
        setLoginRequired(true);
      } else {
        setPageError(t.loadFailed);
      }
    } finally {
      setLoading(false);
    }
  }, [t.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  const startCreate = (): void => {
    setPageError(null);
    setEditing({ id: newPaletteId(), name: '', colors: [] });
  };

  const startEdit = (record: PaletteRecord): void => {
    setPageError(null);
    setEditing({ id: record.id, name: record.name, colors: record.colors });
  };

  const handleSave = async (name: string, colors: EditingState['colors']): Promise<void> => {
    if (!editing) return;
    setSaving(true);
    setPageError(null);
    try {
      const saved = await savePalette(editing.id, name, colors);
      setRecords((prev) => {
        const next = prev.filter((record) => record.id !== saved.id);
        return [saved, ...next];
      });
      setEditing(null);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : null;
      if (code === 'UNAUTHORIZED') setLoginRequired(true);
      else if (code === 'CONFLICT') setPageError(t.limitReached);
      else setPageError(t.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: PaletteRecord): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm(t.deleteConfirm)) return;
    setPageError(null);
    try {
      await deletePalette(record.id);
      setRecords((prev) => prev.filter((item) => item.id !== record.id));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'UNAUTHORIZED') {
        setLoginRequired(true);
      } else {
        setPageError(t.deleteFailed);
      }
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-lilac/30 pb-3">
        <h1 className="text-lg font-semibold text-ink">{t.title}</h1>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/app" className="link-soft">
            {zhCN.nav.workbench}
          </Link>
          <button
            type="button"
            onClick={startCreate}
            className="rounded-full bg-primary px-3 py-1 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-primary-deep"
          >
            {t.newPalette}
          </button>
        </nav>
      </header>

      {pageError && (
        <p role="alert" className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {pageError}
          <button type="button" onClick={() => void load()} className="rounded-full border border-red-300 px-2 py-0.5 text-xs hover:bg-red-100">
            {t.retry}
          </button>
        </p>
      )}

      {loginRequired && (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t.loginRequired}{' '}
          <Link href="/login" className="link-soft">
            {zhCN.nav.login}
          </Link>
        </p>
      )}

      <section aria-label={t.builtinTitle} className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ink-soft">{t.builtinTitle}</h2>
        <p className="text-xs text-ink-soft/80">{t.builtinNote}</p>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {BRANDS.map((brand) => (
            <li key={brand} className="card-surface p-3 text-sm">
              <p className="font-medium text-ink">{brand}</p>
              <p className="text-xs text-ink-soft">{t.colorCount(buildBrandPalette(brand).length)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={t.customTitle} className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ink-soft">{t.customTitle}</h2>
        {loading ? (
          <p className="text-sm text-ink-soft/80">…</p>
        ) : records.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-lilac/50 p-6 text-center text-sm text-ink-soft">
            {t.empty}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {records.map((record) => (
              <li key={record.id} className="card-surface flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{record.name}</p>
                  <p className="text-xs text-ink-soft">
                    {t.colorCount(record.colors.length)} · {new Date(record.updatedAt).toLocaleDateString('zh-CN')}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1 text-xs">
                  <button type="button" onClick={() => startEdit(record)} className="rounded-full px-1.5 py-1 text-primary-deep hover:bg-primary-soft">
                    {t.edit}
                  </button>
                  <button type="button" onClick={() => void handleDelete(record)} className="rounded-full px-1.5 py-1 text-red-600 hover:bg-red-50">
                    {t.delete}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <Modal label={t.edit} onClose={() => setEditing(null)} panelClassName="w-full max-w-2xl max-h-[85vh] overflow-auto">
          <PaletteEditor
            initialName={editing.name}
            initialColors={editing.colors}
            saving={saving}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </main>
  );
}
