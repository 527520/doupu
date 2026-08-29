'use client';

/** 色板管理页（spec §F6）：内置五套只读展示 + 自定义色板 CRUD。 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zhCN } from '@/messages/zh-CN';
import { BRANDS, buildBrandPalette } from '@/lib/palettes';
import PaletteEditor from '@/components/palettes/PaletteEditor';
import PaletteSwatches from '@/components/palettes/PaletteSwatches';
import Modal from '@/components/ui/Modal';
import Notice from '@/components/ui/Notice';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import SiteHeader from '@/components/layout/SiteHeader';
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
  revision: number;
}

export default function PalettesPage() {
  const t = zhCN.palettes;
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<PaletteRecord[]>([]);
  const [loginRequired, setLoginRequired] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);

  /** 未登录（或会话已失效）：跳转登录页，登录后回到本页。 */
  const goLogin = useCallback((): void => {
    setEditing(null);
    router.push('/login?next=/palettes');
  }, [router]);

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
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const startCreate = (): void => {
    setPageError(null);
    // 未登录无法保存自定义色板：直接引导登录（登录后回跳本页），不开空弹窗
    if (loginRequired) {
      goLogin();
      return;
    }
    setEditing({ id: newPaletteId(), name: '', colors: [], revision: 0 });
  };

  const startEdit = (record: PaletteRecord): void => {
    setPageError(null);
    setEditing({ id: record.id, name: record.name, colors: record.colors, revision: record.revision });
  };

  const handleSave = async (name: string, colors: EditingState['colors']): Promise<void> => {
    if (!editing) return;
    setSaving(true);
    setPageError(null);
    try {
      const saved = await savePalette(editing.id, name, colors, editing.revision);
      setRecords((prev) => {
        const next = prev.filter((record) => record.id !== saved.id);
        return [saved, ...next];
      });
      setEditing(null);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : null;
      if (code === 'UNAUTHORIZED') goLogin(); // 会话中途失效：跳登录
      else if (code === 'REVISION_CONFLICT') {
        setPageError(t.revisionConflict);
        setEditing(null);
        await load();
      } else if (code === 'CONFLICT') setPageError(t.limitReached);
      else setPageError(t.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: PaletteRecord): Promise<void> => {
    const ok = await confirm({
      title: t.deleteConfirmTitle(record.name),
      message: t.deleteConfirm,
      confirmLabel: zhCN.common.delete,
      danger: true,
    });
    if (!ok) return;
    setPageError(null);
    try {
      await deletePalette(record.id, record.revision);
      setRecords((prev) => prev.filter((item) => item.id !== record.id));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'UNAUTHORIZED') {
        goLogin();
      } else {
        setPageError(t.deleteFailed);
      }
    }
  };

  return (
    <main id="main" className="workspace-page flex flex-col gap-6">
      <SiteHeader
        title={t.title}
        currentPath="/palettes"
        subtitle={zhCN.workspace.palettesSubtitle}
        primaryActions={
          <button
            type="button"
            onClick={startCreate}
            className="btn-primary btn-sm"
          >
            {t.newPalette}
          </button>
        }
      />

      <section className="palette-hero">
        <div><span className="studio-eyebrow">{t.libraryKicker}</span><h2>{t.heroTitle}</h2><p>{t.heroHint}</p></div>
        <div className="palette-fan" aria-hidden="true"><span /><span /><span /><span /><span /></div>
      </section>

      {pageError && (
        <Notice kind="danger">
          {pageError}
          <button type="button" onClick={() => void load()} className="btn-danger-outline btn-xs">
            {t.retry}
          </button>
        </Notice>
      )}

      {loginRequired && (
        <Notice kind="warning">
          {t.loginRequired}{' '}
          <Link href="/login?next=/palettes" className="link-soft">
            {zhCN.nav.login}
          </Link>
        </Notice>
      )}

      <section aria-label={t.builtinTitle} className="palette-library-section">
        <h2>{t.builtinTitle}</h2>
        <p className="text-xs text-ink-soft/80">{t.builtinNote}</p>
        <ul className="palette-brand-grid">
          {BRANDS.map((brand) => {
            const palette = buildBrandPalette(brand);
            return (
              <li key={brand} className="palette-brand-card">
                <div>
                  <p className="font-medium text-ink">{brand}</p>
                  <p className="text-xs text-ink-soft">{t.colorCount(palette.length)}</p>
                </div>
                {/* E-1：这一页原本一个颜色都看不到，只有「291 色」这个数字。 */}
                <PaletteSwatches name={brand} colors={palette} />
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label={t.customTitle} className="palette-library-section">
        <h2>{t.customTitle}</h2>
        {loading ? (
          <p role="status" className="text-sm text-ink-soft/80">{t.loading}</p>
        ) : records.length === 0 ? (
          <p className="palette-empty">
            {t.empty}
          </p>
        ) : (
          <ul className="palette-custom-grid">
            {records.map((record) => (
              <li key={record.id} className="palette-brand-card">
                <div className="flex items-center justify-between gap-2">
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
                    <button type="button" onClick={() => void handleDelete(record)} className="btn-danger-quiet">
                      {t.delete}
                    </button>
                  </div>
                </div>
                {/* 自定义色板同样要能一眼看到颜色（E-1） */}
                <PaletteSwatches name={record.name} colors={record.colors} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <Modal label={t.edit} onClose={() => setEditing(null)} panelClassName="w-full max-w-xl max-h-[85vh] overflow-auto">
          <PaletteEditor
            initialName={editing.name}
            initialColors={editing.colors}
            saving={saving}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
      {confirmDialog}
    </main>
  );
}
