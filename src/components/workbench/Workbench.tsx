'use client';

/**
 * 工作台（T12）：步骤状态机 上传→裁剪→工作台 + 生成管线 + 编辑器/预览 + 导出 + 本地保存。
 * 本地保存：IndexedDB（未登录可用）；自动保存 1s 防抖 + 手动保存；beforeunload 防丢失；
 * 刷新恢复最后设计；配额满/存储不可用降级提示（E39）。
 * 云端同步接缝（T16/T17）：storage 注入 + onSavedStatus 回调，本票仅本地实现。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
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
import { computeStats } from '@/lib/engine/generate';
import { runGenerate, type GenerateTask } from '@/lib/engine/runGenerate';
import type { ImageDataLike } from '@/lib/engine/types';
import { decodeImageFile, canDecodeHeicNatively, convertHeicWithWasm, type DecodeResult, type DecodedImage } from '@/lib/image/decode';
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
import { usePublicConfig } from '@/components/config/usePublicConfig';

type Step = 'upload' | 'crop' | 'workspace';
type Tab = 'preview' | 'edit';
type PaletteKind = { kind: 'builtin'; brand: Brand } | { kind: 'custom' };

/** 清除 URL 上的 ?id= 参数（开始新设计后，刷新不应再恢复旧设计）。 */
function clearDesignQuery(): void {
  if (typeof window !== 'undefined') {
    window.history.replaceState(null, '', '/app');
  }
}

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
  // 站点公开配置（票 02）：生成默认参数可被服务端环境变量覆盖，改配置即生效
  const pubCfg = usePublicConfig();
  const defaultParams = useMemo<GenerationParams>(
    () => ({
      ...DEFAULT_GENERATION_PARAMS,
      targetWidth: pubCfg.generation.defaultWidth,
      targetColorCount: pubCfg.generation.defaultColorCount,
    }),
    [pubCfg],
  );

  const [step, setStep] = useState<Step>('upload');
  const [decoded, setDecoded] = useState<DecodedImage | null>(null);
  const [source, setSource] = useState<ImageDataLike | null>(null);
  const [paletteKind, setPaletteKind] = useState<PaletteKind>({ kind: 'builtin', brand: 'MARD' });
  const [customPalette, setCustomPalette] = useState<PaletteColor[]>([]);
  /** 当前选中的云端自定义色板 id（null = 导入项目自带的色板或内置品牌）。 */
  const [customPaletteId, setCustomPaletteId] = useState<string | null>(null);
  /** 云端自定义色板列表（优化票 06：登录后从 /api/palettes 加载，工作台可选）。 */
  const [cloudPalettes, setCloudPalettes] = useState<Array<{ id: string; name: string; colors: PaletteColor[] }>>([]);
  const [params, setParams] = useState<GenerationParams>(DEFAULT_GENERATION_PARAMS);
  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [stats, setStats] = useState<PatternStatsItem[]>([]);
  const [total, setTotal] = useState(0);
  const [designId, setDesignId] = useState<string>(() => newDesignId());
  const [name, setName] = useState('');
  const [createdAt, setCreatedAt] = useState('');
  const [savedNames, setSavedNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState<string>(zhCN.workbench.decoding);
  const [generating, setGenerating] = useState(false);
  /** 生成进度（0-100）；null = 不显示进度（快速任务 <300ms 不显示）。 */
  const [progress, setProgress] = useState<number | null>(null);
  /** 生成任务令牌：新任务/重启/导入/卸载使旧任务结果作废（取消语义）。 */
  const genTokenRef = useRef(0);
  /** 在途生成任务句柄（取消按钮/重启/导入/卸载时终止 Worker）。 */
  const taskRef = useRef<GenerateTask | null>(null);
  /** 生成开始时刻：进度条仅当任务超过 300ms 才显示（快速任务直接出结果）。 */
  const genStartedAtRef = useRef(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<{ kind: 'guest' | 'user'; email: string }>({ kind: 'guest', email: '' });

  // 登录态探测：决定头部显示「登录/注册」还是账号邮箱 + 「我的设计」入口
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { method: 'GET' })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as { email?: string } | null;
          setAuthStatus({ kind: 'user', email: body?.email ?? '' });
        } else {
          setAuthStatus({ kind: 'guest', email: '' });
        }
      })
      .catch(() => {
        if (!cancelled) setAuthStatus({ kind: 'guest', email: '' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 优化票 06：登录后加载云端自定义色板进「色板品牌」下拉；失败静默（内置色板照常可用）
  useEffect(() => {
    if (authStatus.kind !== 'user') {
      setCloudPalettes([]);
      return;
    }
    let cancelled = false;
    fetch('/api/palettes', { method: 'GET' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const list = Array.isArray(data)
          ? (data as Array<{ id: string; name: string; colors: Array<{ hex: string; code?: string | null }> }>)
          : [];
        setCloudPalettes(
          list
            .filter((p) => Array.isArray(p.colors) && p.colors.length > 0)
            .map((p) => ({
              id: p.id,
              name: p.name,
              colors: p.colors.map((c) => ({ hex: c.hex, code: c.code || null })),
            })),
        );
      })
      .catch(() => {
        // 静默失败
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus.kind]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [tab, setTab] = useState<Tab>('preview');

  const adapterRef = useRef<StorageAdapter | null>(null);
  const dirtyRef = useRef(false);
  /** 编辑代数：每次置脏 +1；保存完成后仅当代数未变才清脏（避免抹掉保存期间的编辑）。 */
  const editGenRef = useRef(0);

  const markDirty = useCallback((): void => {
    dirtyRef.current = true;
    editGenRef.current += 1;
  }, []);

  const previewTabRef = useRef<HTMLButtonElement>(null);
  const editTabRef = useRef<HTMLButtonElement>(null);

  /** 页签键盘导航：←/→ 切换预览/编辑，焦点跟随（ARIA tabs pattern） */
  const handleTabKey = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next: Tab = tab === 'preview' ? 'edit' : 'preview';
    setTab(next);
    (next === 'preview' ? previewTabRef : editTabRef).current?.focus();
  }, [tab]);

  const palette = useMemo<PaletteColor[]>(
    () => (paletteKind.kind === 'builtin' ? buildBrandPalette(paletteKind.brand) : customPalette),
    [paletteKind, customPalette],
  );

  const paletteOptions = useMemo<PaletteOption[]>(() => {
    const builtin = BRANDS.map((brand) => ({ value: brand, label: brand, kind: 'builtin' as const }));
    const customEntries = cloudPalettes.map((p) => ({
      value: `custom:${p.id}`,
      label: zhCN.workbench.myPaletteLabel(p.name),
      kind: 'custom' as const,
    }));
    // 导入项目自带的自定义色板（无云端 id）保留 '__custom' 占位，不可再切换
    if (paletteKind.kind === 'custom' && !customPaletteId) {
      return [...builtin, ...customEntries, { value: '__custom', label: zhCN.workbench.customPaletteLabel, kind: 'custom' as const }];
    }
    return [...builtin, ...customEntries];
  }, [paletteKind.kind, customPaletteId, cloudPalettes]);

  const selectedPalette =
    paletteKind.kind === 'custom' ? (customPaletteId ? `custom:${customPaletteId}` : '__custom') : paletteKind.brand;

  /** 用当前参数在给定源图上重新生成；失败给出可重试提示。
   * 优化票 07：Worker 后台执行（页面不冻结），进度按阶段上报（>300ms 才显示），
   * 可取消（终止 Worker）；token 防旧结果覆盖新结果（取消语义）。 */
  const regenerate = useCallback(
    (p: GenerationParams, src: ImageDataLike, pal: PaletteColor[]): void => {
      const token = ++genTokenRef.current;
      genStartedAtRef.current = performance.now();
      setProgress(null);
      setGenerating(true);
      setErrorMsg(null);
      const task = runGenerate({ src, params: p, palette: pal }, (percent) => {
        if (token !== genTokenRef.current) return;
        // 快速任务（<300ms）不显示进度条，直接等结果
        if (performance.now() - genStartedAtRef.current >= 300) setProgress(percent);
      });
      taskRef.current = task;
      task.promise
        .then((output) => {
          if (token !== genTokenRef.current) return; // 已发起新任务/重启：丢弃旧结果
          setPattern(output.pattern);
          setStats(output.stats);
          setTotal(output.totalBeadCount);
          markDirty();
        })
        .catch(() => {
          if (token !== genTokenRef.current) return;
          setErrorMsg(t.generateFailed);
        })
        .finally(() => {
          if (token !== genTokenRef.current) return;
          if (taskRef.current === task) taskRef.current = null;
          setGenerating(false);
          setProgress(null);
        });
    },
    [t.generateFailed, markDirty],
  );

  /** 取消在途生成任务：作废令牌 + 丢弃 Worker 结果（不强制终止——Firefox 模块 worker
   * 任务执行中 terminate 会崩溃页面，见 runGenerate 注释），立即回到可交互状态。 */
  const handleCancelGenerate = useCallback((): void => {
    genTokenRef.current += 1;
    taskRef.current?.cancel();
    taskRef.current = null;
    setGenerating(false);
    setProgress(null);
  }, []);

  // ---------- 上传/裁剪 ----------

  const handleUpload = useCallback(
    async ({ bytes, type }: ValidImageFile): Promise<void> => {
      setBusy(true);
      setBusyText(t.decoding);
      setErrorMsg(null);
      try {
        let decodeBytes = bytes;
        let decodeType: ImageType = type;
        // 优化票 05：非 Safari 浏览器无法原生解码 HEIC → WASM 转换兜底（带进度文案）
        if (type === 'heic' && !(await canDecodeHeicNatively())) {
          setBusyText(t.heicConverting);
          try {
            decodeBytes = await convertHeicWithWasm(bytes);
            decodeType = 'jpeg';
          } catch {
            setErrorMsg(zhCN.errors.HEIC_UNSUPPORTED);
            return;
          }
        }
        const result = await decode(decodeBytes, decodeType);
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
    [decode, t.decoding, t.heicConverting],
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
      clearDesignQuery(); // 上传生成的是新设计：清除 ?id/?new，刷新后恢复的即这个新设计
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
      if (value.startsWith('custom:')) {
        const paletteId = value.slice('custom:'.length);
        const found = cloudPalettes.find((p) => p.id === paletteId);
        if (!found) return;
        setPaletteKind({ kind: 'custom' });
        setCustomPalette(found.colors);
        setCustomPaletteId(found.id);
        if (source) regenerate(params, source, found.colors);
        return;
      }
      const brand = value as Brand;
      setPaletteKind({ kind: 'builtin', brand });
      setCustomPaletteId(null);
      const pal = buildBrandPalette(brand);
      if (source) regenerate(params, source, pal);
    },
    [source, params, regenerate, cloudPalettes],
  );

  const handlePatternChange = useCallback((p: Pattern): void => {
    setPattern(p);
    markDirty();
  }, [markDirty]);

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
    const genBefore = editGenRef.current;
    setSaveState('saving');
    try {
      const thumbnail = renderThumbnail(project.pattern, 256);
      await adapter.put(createDesignRecord(designId, project, thumbnail));
      setSavedNames((prev) => (prev.includes(project.name) ? prev : [...prev, project.name]));
      setSaveState('saved');
      // 仅当保存期间没有新的编辑才清脏；否则保持脏标记（自动保存会再兜底一次）
      if (editGenRef.current === genBefore) dirtyRef.current = false;
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

  // 上传步骤时应用配置默认参数（站点配置加载完成后/每次回到上传步骤都同步）
  useEffect(() => {
    if (step === 'upload') setParams(defaultParams);
  }, [step, defaultParams]);

  // 卸载时作废在途生成任务（Worker 终止，结果丢弃）
  useEffect(() => {
    return () => {
      genTokenRef.current += 1;
      taskRef.current?.cancel();
      taskRef.current = null;
    };
  }, []);

  // ---------- 恢复最后设计 ----------

  useEffect(() => {
    // StrictMode 安全：不做 ref 一次性守卫——dev 双调用时第一次会被 cleanup 取消，
    // 第二次必须正常执行完恢复逻辑（此前 ref 守卫导致第二次直接跳过 → 打开设计后空白）。
    // 恢复本身只读 + setState，重复执行幂等。
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
        // 恢复策略：
        // - ?new=1（「新建设计」入口）：不恢复任何历史设计，从空白上传开始；
        // - ?id=X：仅当本地存在该设计时恢复；不存在则保持上传页（绝不回落打开其他设计）；
        // - 无参数（刷新恢复）：恢复最近编辑的设计。
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('new') === '1') return;
        const requestedId = urlParams.get('id');
        const records = await adapter.getAll();
        const last = requestedId ? records.find((r) => r.id === requestedId) : records[0];
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
      genTokenRef.current += 1; // 作废在途生成任务
      taskRef.current?.cancel();
      taskRef.current = null;
      setGenerating(false);
      setProgress(null);
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
        setCustomPaletteId(null);
      }
      setErrorMsg(null);
      markDirty();
      setStep('workspace');
      clearDesignQuery(); // 新设计不再对应 URL ?id= 的旧设计（否则刷新会恢复错对象）
    },
    [markDirty],
  );

  const handleRestart = useCallback((): void => {
    genTokenRef.current += 1; // 作废在途生成任务
    taskRef.current?.cancel();
    taskRef.current = null;
    setGenerating(false);
    setProgress(null);
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
    setParams(defaultParams);
    setPaletteKind({ kind: 'builtin', brand: 'MARD' });
    setCustomPalette([]);
    setCustomPaletteId(null);
    clearDesignQuery();
  }, [defaultParams]);

  const projectPalette = useMemo<ProjectFile['palette']>(
    () =>
      paletteKind.kind === 'builtin'
        ? { kind: 'builtin', brand: paletteKind.brand }
        : { kind: 'custom', colors: customPalette.map((c) => ({ code: c.code ?? '', hex: c.hex })) },
    [paletteKind, customPalette],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-lilac/30 pb-3">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-lg font-semibold text-ink">{t.title}</h1>
          {step === 'workspace' && (
            <>
              <DesignNameEditor name={name} onChange={(n) => { setName(n); markDirty(); }} />
              <span className="text-xs text-ink-soft/80">
                {paletteKind.kind === 'builtin' ? paletteKind.brand : zhCN.workbench.customPaletteLabel}
              </span>
            </>
          )}
        </div>
        {step === 'workspace' && (
          <div className="flex items-center gap-4">
            <SaveStatus state={saveState} loggedIn={authStatus.kind === 'user'} onSave={() => void doSave()} />
            <div className="flex items-center gap-3 text-sm">
              {authStatus.kind === 'guest' ? (
                <>
                  <Link href="/login" className="link-soft">
                    {zhCN.nav.login}
                  </Link>
                  <Link href="/register" className="link-soft">
                    {zhCN.nav.register}
                  </Link>
                </>
              ) : (
                <span className="max-w-[160px] truncate text-ink-soft" title={authStatus.email}>
                  {authStatus.email}
                </span>
              )}
              <Link href="/designs" className="link-soft">
                {zhCN.nav.designs}
              </Link>
            </div>
            <button
              type="button"
              onClick={handleRestart}
              className="rounded-full border border-lilac/60 px-3 py-1 text-sm text-ink-soft transition-colors hover:bg-lilac-soft"
            >
              {t.restart}
            </button>
          </div>
        )}
      </header>

      {busy && <p className="text-sm text-primary-deep" role="status">{busyText}</p>}
      {generating && !busy && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-primary-deep" role="status">
          <span>{t.generating}</span>
          {/* 进度条与百分比用固定宽度槽位：出现/更新时「取消」按钮位置不跳动（可稳定点击） */}
          {progress !== null ? (
            <progress
              value={progress}
              max={100}
              className="h-2 w-48 accent-primary"
              aria-label={t.generatingProgressLabel}
            />
          ) : (
            <span className="inline-block h-2 w-48" aria-hidden="true" />
          )}
          <span className="inline-block w-10 tabular-nums">{progress !== null ? `${progress}%` : ''}</span>
          <button
            type="button"
            onClick={handleCancelGenerate}
            className="underline underline-offset-2 hover:text-primary-deep"
          >
            {t.cancel}
          </button>
        </div>
      )}
      {saveState === 'unavailable' && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t.unavailable}
        </div>
      )}
      {errorMsg && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
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
            <div
              role="tablist"
              aria-label={t.title}
              onKeyDown={handleTabKey}
              className="flex gap-1 rounded-full border border-lilac/40 bg-white p-1 text-sm"
            >
              <button
                ref={previewTabRef}
                type="button"
                id="tab-preview"
                role="tab"
                aria-selected={tab === 'preview'}
                aria-controls="panel-preview"
                tabIndex={tab === 'preview' ? 0 : -1}
                onClick={() => setTab('preview')}
                className={`rounded-full px-3 py-1 transition-colors ${tab === 'preview' ? 'bg-primary text-white' : 'text-ink-soft hover:bg-primary-soft'}`}
              >
                {t.previewTab}
              </button>
              <button
                ref={editTabRef}
                type="button"
                id="tab-edit"
                role="tab"
                aria-selected={tab === 'edit'}
                aria-controls="panel-edit"
                tabIndex={tab === 'edit' ? 0 : -1}
                onClick={() => setTab('edit')}
                className={`rounded-full px-3 py-1 transition-colors ${tab === 'edit' ? 'bg-primary text-white' : 'text-ink-soft hover:bg-primary-soft'}`}
              >
                {t.editTab}
              </button>
            </div>
            {tab === 'preview' ? (
              <div id="panel-preview" role="tabpanel" aria-labelledby="tab-preview">
                <PatternPreview
                  pattern={pattern}
                  onCellHover={(info) =>
                    setHoverInfo(info ? zhCN.preview.cellInfo(info.row, info.col, info.cell.code) : null)
                  }
                />
              </div>
            ) : (
              <div id="panel-edit" role="tabpanel" aria-labelledby="tab-edit">
                <PixelEditorCanvas
                  pattern={pattern}
                  palette={palette}
                  onStatsChange={handleStatsChange}
                  onPatternChange={handlePatternChange}
                />
              </div>
            )}
            {hoverInfo && tab === 'preview' && (
              <p role="status" className="rounded-lg bg-ink px-2 py-1 text-xs text-white">
                {hoverInfo}
              </p>
            )}
            <p className="text-xs text-ink-soft/80">{t.editorHint}</p>
          </section>

          <aside className="flex flex-col gap-4">
            <GenerationParamsPanel
              params={params}
              paletteOptions={paletteOptions}
              selectedPalette={selectedPalette}
              onParamsChange={handleParamsChange}
              onPaletteSelect={handlePaletteSelect}
            />

            <div className="card-surface p-3 text-sm">
              <p className="font-semibold text-ink">
                {t.statsTotal(total)} · {t.colorCount(stats.length)}
              </p>
              <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-auto">
                {stats.slice(0, 50).map((item) => (
                  <li key={item.hex} className="flex items-center gap-2 text-xs text-ink-soft">
                    <span className="inline-block h-3 w-3 rounded-sm border border-lilac/40" style={{ backgroundColor: item.hex }} />
                    <span className="font-mono">{item.code}</span>
                    <span className="ml-auto">{item.count} {zhCN.export.countUnit}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card-surface flex flex-col gap-3 p-3">
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
