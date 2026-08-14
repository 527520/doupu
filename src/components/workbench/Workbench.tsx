'use client';

/**
 * 工作台（T12）：步骤状态机 上传→裁剪→工作台 + 生成管线 + 编辑器/预览 + 导出 + 本地保存。
 * 本地保存：IndexedDB（未登录可用）；自动保存 1s 防抖 + 手动保存；beforeunload 防丢失；
 * 刷新恢复最后设计；配额满/存储不可用降级提示（E39）。
 * 云端同步接缝（T16/T17）：storage 注入 + onSavedStatus 回调，本票仅本地实现。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UploadDropzone, type ValidImageFile } from '@/components/upload/UploadDropzone';
import { ImageCropper } from '@/components/crop/ImageCropper';
import GenerationParamsPanel, { type PaletteOption } from '@/components/params/GenerationParamsPanel';
import PatternPreview from '@/components/preview/PatternPreview';
import PixelEditorCanvas from '@/components/editor/PixelEditorCanvas';
import PngExportButton from '@/components/export/PngExportButton';
import PdfExportButton from '@/components/export/PdfExportButton';
import ProjectFileButtons from '@/components/export/ProjectFileButtons';
import DesignNameEditor from './DesignNameEditor';
import SaveStatus, { type SaveState } from './SaveStatus';
import { zhCN } from '@/messages/zh-CN';
import { DEFAULT_GENERATION_PARAMS, BRANDS, type Brand, type GenerationParams, type PaletteColor, type Pattern, type PatternStatsItem, type ProjectFile } from '@/lib/types';
import { buildBrandPalette } from '@/lib/palettes';
import { cropImageData, type Rect } from '@/lib/crop/layout';
import { computeStats, generatePattern } from '@/lib/engine/generate';
import type { ImageDataLike } from '@/lib/engine/types';
import { decodeImageFile, type DecodeResult, type DecodedImage } from '@/lib/image/decode';
import { validatePixelCount } from '@/lib/image/validation';
import type { ImageType } from '@/lib/image/sniff';
import {
  createDesignRecord,
  isQuotaError,
  newDesignId,
  openIndexedDb,
  parseStoredProject,
  renderThumbnail,
  type StorageAdapter,
} from '@/lib/storage';
import { PROJECT_FILE_FORMAT, PROJECT_FILE_VERSION } from '@/lib/appInfo';

type Step = 'upload' | 'crop' | 'workspace';
type Tab = 'preview' | 'edit';
type PaletteKind = { kind: 'builtin'; brand: Brand } | { kind: 'custom' };

interface WorkbenchProps {
  /** 测试/环境注入：本地存储适配器；null 表示不可用；缺省自行打开 IndexedDB。 */
  storage?: StorageAdapter | null;
  /** 测试注入：解码函数（默认 decodeImageFile）。 */
  decodeFn?: (bytes: Uint8Array, type: ImageType) => Promise<DecodeResult>;
  /** T17 接缝：保存状态变化回调。 */
  onSavedStatus?: (status: SaveState) => void;
}

export default function Workbench({ storage, decodeFn, onSavedStatus }: WorkbenchProps) {
  const t = zhCN.workbench;
  const decode = decodeFn ?? decodeImageFile;

  const [step, setStep] = useState<Step>('upload');
  const [decoded, setDecoded] = useState<DecodedImage | null>(null);
  const [source, setSource] = useState<ImageDataLike | null>(null);
  const [paletteKind, setPaletteKind] = useState<PaletteKind>({ kind: 'builtin', brand: 'MARD' });
  const [customPalette, setCustomPalette] = useState<PaletteColor[]>([]);
  const [params, setParams] = useState<GenerationParams>(DEFAULT_GENERATION_PARAMS);
  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [stats, setStats] = useState<PatternStatsItem[]>([]);
  const [total, setTotal] = useState(0);
  const [designId, setDesignId] = useState<string>(() => newDesignId());
  const [name, setName] = useState('');
  const [createdAt, setCreatedAt] = useState('');
  const [savedNames, setSavedNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [tab, setTab] = useState<Tab>('preview');

  const adapterRef = useRef<StorageAdapter | null>(null);
  const dirtyRef = useRef(false);
  const restoredRef = useRef(false);

  const palette = useMemo<PaletteColor[]>(
    () => (paletteKind.kind === 'builtin' ? buildBrandPalette(paletteKind.brand) : customPalette),
    [paletteKind, customPalette],
  );

  const paletteOptions = useMemo<PaletteOption[]>(() => {
    const builtin = BRANDS.map((brand) => ({ value: brand, label: brand, kind: 'builtin' as const }));
    return paletteKind.kind === 'custom'
      ? [...builtin, { value: '__custom', label: zhCN.workbench.customPaletteLabel, kind: 'custom' as const }]
      : builtin;
  }, [paletteKind]);

  const selectedPalette = paletteKind.kind === 'custom' ? '__custom' : paletteKind.brand;

  /** 用当前参数在给定源图上重新生成；失败给出可重试提示。 */
  const regenerate = useCallback(
    (p: GenerationParams, src: ImageDataLike, pal: PaletteColor[]): void => {
      try {
        const output = generatePattern(src, p, pal);
        setPattern(output.pattern);
        setStats(output.stats);
        setTotal(output.totalBeadCount);
        setErrorMsg(null);
        dirtyRef.current = true;
      } catch {
        setErrorMsg(t.generateFailed);
      }
    },
    [t.generateFailed],
  );

  // ---------- 上传/裁剪 ----------

  const handleUpload = useCallback(
    async ({ bytes, type }: ValidImageFile): Promise<void> => {
      setBusy(true);
      setErrorMsg(null);
      try {
        const result = await decode(bytes, type);
        if (!result.ok) {
          setErrorMsg(zhCN.errors[result.code]);
          return;
        }
        const pixels = validatePixelCount(result.image.width, result.image.height);
        if (!pixels.ok) {
          setErrorMsg(zhCN.errors[pixels.code]);
          return;
        }
        setDecoded(result.image);
        setStep('crop');
      } finally {
        setBusy(false);
      }
    },
    [decode],
  );

  const handleCropConfirm = useCallback(
    (rect: Rect): void => {
      if (!decoded) return;
      const cropped = cropImageData(decoded, rect);
      setSource(cropped);
      setDecoded(null);
      setCreatedAt(new Date().toISOString());
      regenerate(params, cropped, palette);
      setStep('workspace');
    },
    [decoded, params, palette, regenerate],
  );

  const handleCropCancel = useCallback((): void => {
    setDecoded(null);
    setErrorMsg(null);
    setStep('upload');
  }, []);

  // ---------- 参数/色板/编辑 ----------

  const handleParamsChange = useCallback(
    (p: GenerationParams): void => {
      setParams(p);
      if (source) regenerate(p, source, palette);
    },
    [source, palette, regenerate],
  );

  const handlePaletteSelect = useCallback(
    (value: string): void => {
      if (value === '__custom') return; // 导入的自定义色板不可再切换（T18 提供管理）
      const brand = value as Brand;
      setPaletteKind({ kind: 'builtin', brand });
      const pal = buildBrandPalette(brand);
      if (source) regenerate(params, source, pal);
    },
    [source, params, regenerate],
  );

  const handlePatternChange = useCallback((p: Pattern): void => {
    setPattern(p);
    dirtyRef.current = true;
  }, []);

  const handleStatsChange = useCallback((s: PatternStatsItem[], count: number): void => {
    setStats(s);
    setTotal(count);
  }, []);

  // ---------- 保存 ----------

  const buildProject = useCallback((): ProjectFile | null => {
    if (!pattern) return null;
    return {
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      name: name.trim() || zhCN.project.unnamed,
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      palette:
        paletteKind.kind === 'builtin'
          ? { kind: 'builtin', brand: paletteKind.brand }
          : { kind: 'custom', colors: customPalette.map((c) => ({ code: c.code ?? '', hex: c.hex })) },
      params,
      pattern,
    };
  }, [pattern, name, createdAt, paletteKind, customPalette, params]);

  const doSave = useCallback(async (): Promise<void> => {
    const adapter = adapterRef.current;
    if (!adapter) {
      setSaveState('unavailable');
      return;
    }
    const project = buildProject();
    if (!project) return;
    setSaveState('saving');
    try {
      const thumbnail = renderThumbnail(project.pattern, 256);
      await adapter.put(createDesignRecord(designId, project, thumbnail));
      setSavedNames((prev) => (prev.includes(project.name) ? prev : [...prev, project.name]));
      setSaveState('saved');
      dirtyRef.current = false;
    } catch (error) {
      setSaveState(isQuotaError(error) ? 'quota' : 'error');
    }
  }, [adapterRef, buildProject, designId]);

  // 自动保存：dirty 时 1s 防抖（spec §F8）
  useEffect(() => {
    if (step !== 'workspace' || !dirtyRef.current || !pattern) return;
    const timer = setTimeout(() => void doSave(), 1000);
    return () => clearTimeout(timer);
  }, [pattern, name, params, paletteKind, step, doSave]);

  // beforeunload 防丢失
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent): void => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = t.confirmLeave;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [t.confirmLeave]);

  // 保存状态接缝（T17）
  useEffect(() => {
    onSavedStatus?.(saveState);
  }, [saveState, onSavedStatus]);

  // ---------- 恢复最后设计 ----------

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    let cancelled = false;
    const restore = async (): Promise<void> => {
      try {
        const adapter = storage === undefined ? await openIndexedDb() : storage;
        if (cancelled) return;
        adapterRef.current = adapter;
        if (!adapter) {
          setSaveState('unavailable');
          return;
        }
        const records = await adapter.getAll();
        const last = records[0];
        if (!last) return;
        const project = parseStoredProject(last.projectJson);
        if (!project) return;
        setDesignId(last.id);
        setName(project.name);
        setCreatedAt(project.createdAt);
        setParams(project.params);
        setPattern(project.pattern);
        const computed = computeStats(project.pattern.cells);
        setStats(computed);
        setTotal(computed.reduce((sum, item) => sum + item.count, 0));
        setSavedNames(records.map((r) => r.name));
        if (project.palette.kind === 'builtin') {
          setPaletteKind({ kind: 'builtin', brand: project.palette.brand });
        } else {
          setCustomPalette(project.palette.colors.map((c) => ({ hex: c.hex, code: c.code || null })));
          setPaletteKind({ kind: 'custom' });
        }
        setStep('workspace');
      } catch {
        adapterRef.current = null;
        setSaveState('unavailable');
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [storage]);

  // ---------- 导入 ----------

  const handleImport = useCallback(
    (project: ProjectFile): void => {
      setDesignId(newDesignId());
      setName(project.name);
      setCreatedAt(project.createdAt);
      setParams(project.params);
      setPattern(project.pattern);
      const computed = computeStats(project.pattern.cells);
      setStats(computed);
      setTotal(computed.reduce((sum, item) => sum + item.count, 0));
      if (project.palette.kind === 'builtin') {
        setPaletteKind({ kind: 'builtin', brand: project.palette.brand });
      } else {
        setCustomPalette(project.palette.colors.map((c) => ({ hex: c.hex, code: c.code || null })));
        setPaletteKind({ kind: 'custom' });
      }
      setErrorMsg(null);
      dirtyRef.current = true;
      setStep('workspace');
    },
    [],
  );

  const handleRestart = useCallback((): void => {
    dirtyRef.current = false;
    setStep('upload');
    setDecoded(null);
    setSource(null);
    setPattern(null);
    setStats([]);
    setTotal(0);
    setErrorMsg(null);
    setDesignId(newDesignId());
    setName('');
    setCreatedAt('');
    setParams(DEFAULT_GENERATION_PARAMS);
    setPaletteKind({ kind: 'builtin', brand: 'MARD' });
    setCustomPalette([]);
  }, []);

  const projectPalette = useMemo<ProjectFile['palette']>(
    () =>
      paletteKind.kind === 'builtin'
        ? { kind: 'builtin', brand: paletteKind.brand }
        : { kind: 'custom', colors: customPalette.map((c) => ({ code: c.code ?? '', hex: c.hex })) },
    [paletteKind, customPalette],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-lg font-semibold">{t.title}</h1>
          {step === 'workspace' && (
            <>
              <DesignNameEditor name={name} onChange={(n) => { setName(n); dirtyRef.current = true; }} />
              <span className="text-xs text-gray-400">
                {paletteKind.kind === 'builtin' ? paletteKind.brand : zhCN.workbench.customPaletteLabel}
              </span>
            </>
          )}
        </div>
        {step === 'workspace' && (
          <div className="flex items-center gap-4">
            <SaveStatus state={saveState} onSave={() => void doSave()} />
            <button
              type="button"
              onClick={handleRestart}
              className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
            >
              {t.restart}
            </button>
          </div>
        )}
      </header>

      {busy && <p className="text-sm text-blue-600">{t.decoding}</p>}
      {saveState === 'unavailable' && (
        <div role="alert" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t.unavailable}
        </div>
      )}
      {errorMsg && (
        <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {step === 'upload' && <UploadDropzone onValid={(file) => void handleUpload(file)} disabled={busy} />}

      {step === 'crop' && decoded && (
        <ImageCropper image={decoded} onConfirm={handleCropConfirm} onCancel={handleCropCancel} />
      )}

      {step === 'workspace' && pattern && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <section className="flex flex-col gap-3">
            <div role="tablist" aria-label={t.title} className="flex gap-1 rounded border border-gray-200 p-1 text-sm">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'preview'}
                onClick={() => setTab('preview')}
                className={`rounded px-3 py-1 ${tab === 'preview' ? 'bg-blue-600 text-white' : 'text-gray-600'}`}
              >
                {t.previewTab}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'edit'}
                onClick={() => setTab('edit')}
                className={`rounded px-3 py-1 ${tab === 'edit' ? 'bg-blue-600 text-white' : 'text-gray-600'}`}
              >
                {t.editTab}
              </button>
            </div>
            {tab === 'preview' ? (
              <PatternPreview pattern={pattern} />
            ) : (
              <PixelEditorCanvas
                pattern={pattern}
                palette={palette}
                onStatsChange={handleStatsChange}
                onPatternChange={handlePatternChange}
              />
            )}
            <p className="text-xs text-gray-400">{t.editorHint}</p>
          </section>

          <aside className="flex flex-col gap-4">
            <GenerationParamsPanel
              params={params}
              paletteOptions={paletteOptions}
              selectedPalette={selectedPalette}
              onParamsChange={handleParamsChange}
              onPaletteSelect={handlePaletteSelect}
            />

            <div className="rounded border border-gray-200 p-3 text-sm">
              <p className="font-medium text-gray-700">
                {t.statsTotal(total)} · {t.colorCount(stats.length)}
              </p>
              <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-auto">
                {stats.slice(0, 50).map((item) => (
                  <li key={item.hex} className="flex items-center gap-2 text-xs text-gray-600">
                    <span className="inline-block h-3 w-3 rounded-sm border border-gray-300" style={{ backgroundColor: item.hex }} />
                    <span className="font-mono">{item.code}</span>
                    <span className="ml-auto">{item.count} {zhCN.export.countUnit}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-3 rounded border border-gray-200 p-3">
              <PngExportButton pattern={pattern} designName={name.trim() || zhCN.project.unnamed} />
              <PdfExportButton name={name.trim() || zhCN.project.unnamed} pattern={pattern} stats={stats} />
              <ProjectFileButtons
                source={{ name: name.trim() || zhCN.project.unnamed, createdAt: createdAt || new Date().toISOString(), palette: projectPalette, params, pattern }}
                existingNames={savedNames}
                onImport={handleImport}
              />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
