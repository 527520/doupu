'use client';

/** 色板管理页（spec §F6）：内置资料库只读展示 + 自定义色板 CRUD。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zhCN } from '@/messages/zh-CN';
import {
  getBuiltinPalette,
  listBuiltinPalettes,
  type BuiltinPaletteExclusions,
  type BuiltinPaletteSummary,
} from '@/lib/palettes';
import { compatibleBoardProfilesForPalette } from '@/lib/boardProfiles';
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

const BUILTIN_PALETTES = listBuiltinPalettes();

function matchesCatalogQuery(palette: BuiltinPaletteSummary, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  if (!normalized) return true;
  const compatibleSpecifications = compatibleBoardProfilesForPalette({ kind: 'builtin', brand: palette.id })
    .map((profile) => profile.displayName)
    .join(' ');
  return [
    palette.label,
    palette.brand,
    palette.series,
    palette.description,
    palette.specification,
    compatibleSpecifications,
    palette.source.repository,
    palette.source.qualityLabel,
    palette.source.qualitySummary,
    palette.market?.label,
    palette.market?.summary,
  ].some((value) => value?.toLocaleLowerCase('zh-CN').includes(normalized));
}

function describeCompatibleSpecifications(palette: BuiltinPaletteSummary): string {
  return compatibleBoardProfilesForPalette({ kind: 'builtin', brand: palette.id })
    .map((profile) => profile.displayName)
    .join('、');
}

function describeExclusions(exclusions: BuiltinPaletteExclusions): string {
  const t = zhCN.palettes;
  const parts = [
    exclusions.unavailableCode > 0 ? t.exclusionUnavailable(exclusions.unavailableCode) : null,
    exclusions.transparent > 0 ? t.exclusionTransparent(exclusions.transparent) : null,
    exclusions.unidentified > 0 ? t.exclusionUnidentified(exclusions.unidentified) : null,
    exclusions.duplicateHex > 0 ? t.exclusionDuplicate(exclusions.duplicateHex) : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join('、') : t.noExclusions;
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
  const savingRef = useRef(false);
  const deletingRef = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorLoginRequired, setEditorLoginRequired] = useState(false);
  const [targetDesignId, setTargetDesignId] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');

  const filteredCatalogGroups = useMemo(() => {
    const groups = new Map<string, BuiltinPaletteSummary[]>();
    for (const palette of BUILTIN_PALETTES) {
      if (!matchesCatalogQuery(palette, catalogQuery)) continue;
      const items = groups.get(palette.brand) ?? [];
      items.push(palette);
      groups.set(palette.brand, items);
    }
    return Array.from(groups);
  }, [catalogQuery]);
  const filteredCatalogCount = filteredCatalogGroups.reduce((total, [, palettes]) => total + palettes.length, 0);

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
    const timer = window.setTimeout(() => {
      const id = new URLSearchParams(window.location.search).get('designId') ?? '';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) setTargetDesignId(id);
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const startCreate = (): void => {
    setPageError(null);
    setEditorError(null); setEditorLoginRequired(false);
    // 未登录无法保存自定义色板：直接引导登录（登录后回跳本页），不开空弹窗
    if (loginRequired) {
      goLogin();
      return;
    }
    setEditing({ id: newPaletteId(), name: '', colors: [], revision: 0 });
  };

  const startEdit = (record: PaletteRecord): void => {
    setPageError(null);
    setEditorError(null); setEditorLoginRequired(false);
    setEditing({ id: record.id, name: record.name, colors: record.colors, revision: record.revision });
  };

  const handleSave = async (name: string, colors: EditingState['colors']): Promise<void> => {
    if (!editing || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setEditorError(null); setEditorLoginRequired(false);
    try {
      const saved = await savePalette(editing.id, name, colors, editing.revision);
      setRecords((prev) => {
        const next = prev.filter((record) => record.id !== saved.id);
        return [saved, ...next];
      });
      setEditing(null);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : null;
      if (code === 'UNAUTHORIZED') { setEditorError(t.loginExpiredKept); setEditorLoginRequired(true); }
      else if (code === 'REVISION_CONFLICT') {
        setEditorError(t.conflictInputKept(t.revisionConflict));
      } else if (code === 'CONFLICT') setEditorError(t.limitReached);
      else setEditorError(t.saveFailed);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async (record: PaletteRecord): Promise<void> => {
    if (deletingRef.current) return;
    deletingRef.current = true; setDeleting(true);
    try {
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
    } finally { deletingRef.current = false; setDeleting(false); }
  };

  const renderPaletteLink = (value: string) => targetDesignId ? <Link className="btn-outline btn-sm" href={`/app?${new URLSearchParams({ id: targetDesignId, palette: value })}`}>{t.useForDesign}</Link> : null;

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
        <div><h2>{t.heroTitle}</h2><p>{t.heroHint}</p><p>{targetDesignId ? t.targetHelp : t.noTargetHelp}</p></div>
        {targetDesignId && <Link href={`/app?id=${targetDesignId}`} className="btn-outline">{t.backToDesign}</Link>}
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
        <div className="palette-catalog-toolbar">
          <label className="palette-search-field">
            <span>{t.searchLabel}</span>
            <input
              type="search"
              value={catalogQuery}
              onChange={(event) => setCatalogQuery(event.target.value)}
              placeholder={t.searchPlaceholder}
              className="input-compact"
            />
          </label>
          <p role="status" aria-live="polite" className="palette-search-status">
            {t.searchResults(filteredCatalogCount, BUILTIN_PALETTES.length)}
          </p>
        </div>
        {filteredCatalogGroups.length === 0 ? (
          <p className="palette-empty">{t.noSearchResults}</p>
        ) : (
          <div className="palette-brand-groups">
            {filteredCatalogGroups.map(([brandLabel, summaries], brandIndex) => {
              const headingId = `palette-brand-${brandIndex}`;
              return (
                <section key={brandLabel} aria-labelledby={headingId} className="palette-brand-group">
                  <div className="palette-brand-heading">
                    <h3 id={headingId}>{brandLabel}</h3>
                    <span>{t.paletteCount(summaries.length)}</span>
                  </div>
                  <ul className="palette-series-grid">
                    {summaries.map((summary) => {
                      const palette = getBuiltinPalette(summary.id);
                      return (
                        <li key={palette.id} className="palette-brand-card palette-series-card">
                          <div className="palette-series-heading">
                            <p className="palette-card-brand">{palette.brand}</p>
                            <h4>{palette.series}</h4>
                            <p>{palette.description}</p>
                          </div>
                          <dl className="palette-card-meta">
                            <div>
                              <dt>{t.collectedColors}</dt>
                              <dd>{t.colorCount(palette.colorCount)}</dd>
                            </div>
                            <div>
                              <dt>{t.engineColors}</dt>
                              <dd>{t.colorCount(palette.engineColorCount)}</dd>
                            </div>
                            <div>
                              <dt>{t.specification}</dt>
                              <dd>{describeCompatibleSpecifications(palette)}</dd>
                            </div>
                          </dl>
                          <PaletteSwatches name={palette.label} colors={palette.colors} />
                          {renderPaletteLink(`builtin:${palette.id}`)}
                          <details className="palette-source-details"><summary>{t.sources}</summary><dl className="palette-card-meta">
                            <div>
                              <dt>{t.sourceQuality}</dt>
                              <dd>
                                <strong>{palette.source.qualityLabel}</strong>
                                <span>{palette.source.qualitySummary}</span>
                                <span>{palette.source.repository} · {palette.source.license}</span>
                              </dd>
                            </div>
                            <div>
                              <dt>{t.exclusions}</dt>
                              <dd>{describeExclusions(palette.exclusions)}</dd>
                            </div>
                          </dl></details>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </section>

      <section aria-label={t.customTitle} className="palette-library-section">
        <h2>{t.customTitle}</h2>
        {loading ? (
          <p role="status" className="text-sm text-ink-soft/80">{t.loading}</p>
        ) : records.length === 0 && (pageError || loginRequired) ? <p className="palette-empty">{loginRequired ? t.loginToRead : t.readUnknown}</p> : records.length === 0 ? (
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
                    <button type="button" disabled={deleting} onClick={() => void handleDelete(record)} className="btn-danger-quiet">
                      {t.delete}
                    </button>
                  </div>
                </div>
                {/* 自定义色板同样要能一眼看到颜色（E-1） */}
                <PaletteSwatches name={record.name} colors={record.colors} />
                {renderPaletteLink(`custom:${record.id}`)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <Modal label={t.edit} onClose={() => { if (!savingRef.current) setEditing(null); }} panelClassName="w-full max-w-xl max-h-[85vh] overflow-auto">
          {editorError && <div role="alert" className="notice notice-danger">{editorError}{editorLoginRequired && <Link href="/login?next=/palettes" target="_blank" rel="noopener noreferrer" className="link-soft">{t.loginWindow}</Link>}</div>}
          <fieldset disabled={saving}>
          <PaletteEditor
            initialName={editing.name}
            initialColors={editing.colors}
            saving={saving}
            onSave={handleSave}
            onCancel={() => { if (!savingRef.current) setEditing(null); }}
          />
          </fieldset>
        </Modal>
      )}
      {confirmDialog}
    </main>
  );
}
