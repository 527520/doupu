'use client';

/**
 * 工作台（T12）：步骤状态机 上传→裁剪→工作台 + 生成管线 + 编辑器/预览 + 导出 + 本地保存。
 * 本地保存：IndexedDB（未登录可用）；自动保存 1s 防抖 + 手动保存；beforeunload 防丢失；
 * 刷新恢复最后设计；配额满/存储不可用降级提示（E39）。
 * 云端同步接缝（T16/T17）：storage 注入 + onSavedStatus 回调，本票仅本地实现。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UploadDropzone, type ValidImageFile } from '@/components/upload/UploadDropzone';
import { takePendingUpload } from '@/lib/upload/pendingUpload';
import Notice from '@/components/ui/Notice';
import ShoppingListPanel from '@/components/export/ShoppingListPanel';
import StitchView from '@/components/stitch/StitchView';
import ShareButton from '@/components/share/ShareButton';
import {
  createStitchProgress,
  isProgressCompatible,
  type StitchProgress,
} from '@/lib/progress/stitchProgress';
import StepIndicator from '@/components/workbench/StepIndicator';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useAuthStatus } from '@/components/account/useAuthStatus';
import { ImageCropper } from '@/components/crop/ImageCropper';
import GenerationParamsPanel, { type PaletteOption } from '@/components/params/GenerationParamsPanel';
import PatternPreview from '@/components/preview/PatternPreview';
import PixelEditorCanvas from '@/components/editor/PixelEditorCanvas';
import PngExportButton from '@/components/export/PngExportButton';
import PdfExportButton from '@/components/export/PdfExportButton';
import ProjectFileButtons from '@/components/export/ProjectFileButtons';
import SiteHeader from '@/components/layout/SiteHeader';
import DesignNameEditor from './DesignNameEditor';
import SaveStatus, { type CloudSaveState, type SaveState } from './SaveStatus';
import { zhCN } from '@/messages/zh-CN';
import { DEFAULT_GENERATION_PARAMS, BRANDS, type Brand, type GenerationParams, type PaletteColor, type Pattern, type ProjectFile, type ProjectPalette } from '@/lib/types';
import { buildBrandPalette } from '@/lib/palettes';
import { cropImageData, type Rect } from '@/lib/crop/layout';
import { computeStats, totalBeadCount, MAX_GENERATION_SOURCE_DIMENSION } from '@/lib/engine/generate';
import { remapPattern } from '@/lib/engine/remap';
import { BOARD_SIZE } from '@/lib/export/pdfLayout';
import { createBlankPattern, selectKitColors } from '@/lib/engine/kit';

/** 空白起稿的尺寸档（H-2）：按板给，1 板 29×29 是最常见的起手规格。 */
const BLANK_PRESETS = [1, 2, 3] as const;
import { disposeGenerateWorker, prepareGenerationSource, runGenerate } from '@/lib/engine/runGenerate';
import {
  selectCommittedSnapshot,
  type GenerationDraft,
} from '@/lib/engine/session';
import { useGenerationSession } from '@/lib/engine/useGenerationSession';
import type { EngineOutput, ImageDataLike } from '@/lib/engine/types';
import {
  createImageDecoder,
  decodeImageFile,
  decodeImageRegion,
  type DecodeResult,
  type DecodedImage,
  type ImageDecoder,
} from '@/lib/image/decode';
import { validatePixelCount } from '@/lib/image/validation';
import type { ImageType } from '@/lib/image/sniff';
import {
  createLocalGenerationSource,
  createDesignRecord,
  imageDataFromLocalGenerationSource,
  isQuotaError,
  newDesignId,
  openIndexedDb,
  parseStoredProject,
  replaceGenerationSource,
  renderThumbnail,
  type LocalGenerationSourceV1,
  type StorageAdapter,
} from '@/lib/storage';
import { conflictName } from '@/lib/project/parse';
import { ENGINE_VERSION, PROJECT_FILE_FORMAT, PROJECT_FILE_VERSION } from '@/lib/appInfo';
import { usePublicConfig } from '@/components/config/usePublicConfig';
import { createDoupuApi } from '@/lib/sync/api';
import { enqueueDesignSync, withDesignStorageLock } from '@/lib/sync/queue';
import type { SyncOutcome } from '@/lib/sync/clientAdapter';
import { getPaletteColors, listPalettes } from '@/components/palettes/api';

type Step = 'upload' | 'crop' | 'workspace';
type Tab = 'preview' | 'edit' | 'stitch';
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
  /** 测试注入：按自然像素选区解码到有界生成缓冲。 */
  decodeRegionFn?: typeof decodeImageRegion;
  /** 测试/运行时接缝：持久图片 Worker；注入实例的生命周期由调用方拥有。 */
  imageDecoder?: ImageDecoder;
  /** T17 接缝：保存状态变化回调。 */
  onSavedStatus?: (status: SaveState) => void;
  /** 测试/运行时接缝：可替换 Worker adapter，验证失败与取消状态。 */
  generateFn?: typeof runGenerate;
}

export default function Workbench({ storage, decodeFn, decodeRegionFn, imageDecoder, onSavedStatus, generateFn }: WorkbenchProps) {
  const t = zhCN.workbench;
  const router = useRouter();
  // 破坏性操作统一走品牌确认弹窗（C-7），不再用 window.confirm。
  const { confirm, confirmDialog } = useConfirm();
  const [ownedImageDecoder] = useState<ImageDecoder>(() => createImageDecoder());
  const activeImageDecoder = imageDecoder ?? ownedImageDecoder;
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
  const encodedSourceRef = useRef<{ bytes: Uint8Array; type: ImageType } | null>(null);
  /** Restored projects rebind an original image without becoming a new design. */
  const rebindRestoredSourceRef = useRef(false);
  /** 新裁剪的生成源，等待首次与设计记录原子写入。 */
  const pendingGenerationSourceRef = useRef<ImageDataLike | null>(null);
  /** 当前选中的云端自定义色板 id（null = 导入项目自带的色板或内置品牌）。 */
  const [customPaletteId, setCustomPaletteId] = useState<string | null>(null);
  /** 云端自定义色板列表（优化票 06：登录后从 /api/palettes 加载，工作台可选）。 */
  const [cloudPalettes, setCloudPalettes] = useState<Array<{ id: string; name: string; colors: PaletteColor[] }>>([]);
  /** 云端自定义色板加载失败（D-4）：内置色板仍可用，因此只是提示而非阻断。 */
  const [paletteLoadFailed, setPaletteLoadFailed] = useState(false);
  const initialGenerationDraft = useMemo<GenerationDraft>(() => {
    const initialPalette = buildBrandPalette('MARD');
    return {
      params: defaultParams,
      palette: initialPalette,
      projectPalette: { kind: 'builtin', brand: 'MARD' },
    };
  }, [defaultParams]);
  const [designId, setDesignId] = useState<string>(() => newDesignId());
  const designIdRef = useRef(designId);
  const setActiveDesignId = useCallback((id: string): void => {
    designIdRef.current = id;
    setDesignId(id);
  }, []);
  const [name, setName] = useState('');
  const [createdAt, setCreatedAt] = useState('');
  const [savedNames, setSavedNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState<string>(zhCN.workbench.decoding);
  const {
    state: generationSession,
    generate: startGeneration,
    cancel: cancelGeneration,
    upload: uploadGenerationSource,
    reupload: reuploadGenerationSource,
    updateDraft: updateGenerationDraft,
    restore: restoreGeneration,
    commitManualEdit,
    remapPalette,
    undoRegeneration,
  } = useGenerationSession<EngineOutput>(initialGenerationDraft);
  const source = generationSession.source;
  const generating = generationSession.status === 'generating';
  // Pattern/statistics are projections of the session's immutable commit;
  // Workbench never mirrors a second independently mutable copy.
  const pattern = generationSession.committed?.pattern ?? null;
  const stats = generationSession.committed?.stats ?? [];
  const total = generationSession.committed?.total ?? 0;
  /**
   * 生成完成计数（D-1）：每次成功 +1，用来重播结果句的上浮并触发一次礼貌播报。
   * 0 表示本会话还没生成过（不放动效）。
   */
  const [doneToken, setDoneToken] = useState(0);
  const patternRegionRef = useRef<HTMLDivElement>(null);
  const firstDoneHandledRef = useRef(false);
  const generationDraft = generationSession.draft ?? initialGenerationDraft;
  const params = generationDraft.params;
  const palette = generationDraft.palette;
  const projectPalette = generationDraft.projectPalette;
  const paletteKind: PaletteKind = useMemo(
    () => (projectPalette.kind === 'builtin'
      ? { kind: 'builtin', brand: projectPalette.brand }
      : { kind: 'custom' }),
    [projectPalette],
  );
  /** 快速任务 <300ms 不显示进度槽；实际进度由 generationSession 独占。 */
  const [showProgress, setShowProgress] = useState(false);
  const progress = showProgress ? generationSession.progress : null;
  /** 生成开始时刻：进度条仅当任务超过 300ms 才显示（快速任务直接出结果）。 */
  const genStartedAtRef = useRef(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const visibleErrorMsg = errorMsg ?? generationSession.error;
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<string | null>(null);
  /**
   * 登录态（J-1）：决定头部显示「登录/注册」还是账号邮箱。
   * 探测逻辑收在 useAuthStatus，与首页导航、新手引导共用同一套 401/网络失败处理。
   * 这里把 loading 视为 guest —— 工作台不需要等登录态就能用。
   */
  const auth = useAuthStatus();
  const authStatus = useMemo(
    () => (auth.kind === 'user'
      ? { kind: 'user' as const, email: auth.email }
      : { kind: 'guest' as const, email: '' }),
    [auth],
  );

  // 优化票 06：登录后加载云端自定义色板进「色板品牌」下拉；失败静默（内置色板照常可用）
  useEffect(() => {
    if (authStatus.kind !== 'user') {
      return;
    }
    let cancelled = false;
    listPalettes()
      .then((list) => {
        if (cancelled) return;
        setCloudPalettes(
          list
            .map((record) => ({ ...record, colors: getPaletteColors(record) }))
            .filter((record) => record.colors.length > 0)
            .map((p) => ({
              id: p.id,
              name: p.name,
              colors: p.colors,
            })),
        );
      })
      .catch(() => {
        // D-4：以前这里是空 catch，云端色板加载失败时用户完全不知道——
        // 下拉里只是「少了」自己的色板，会以为色板丢了。文案早已写好但从未渲染。
        if (!cancelled) setPaletteLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus.kind]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [cloudSaveState, setCloudSaveState] = useState<CloudSaveState>('pending');
  const [storageReady, setStorageReady] = useState(false);
  const [tab, setTab] = useState<Tab>('preview');
  /**
   * 跟拼进度（G-1）：按设计 id 存在本机 IndexedDB，与图纸尺寸绑定。
   * null 表示本地存储不可用（隐私模式）；尺寸不匹配时重建，避免把「已拼」错位。
   */
  const [stitchProgress, setStitchProgress] = useState<StitchProgress | null>(null);
  const stitchSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 换色板结果提示（H-1）：告诉用户换了多少格，并提示可撤销。 */
  const [remapNotice, setRemapNotice] = useState<string | null>(null);
  /**
   * 套装档位（H-3）：0 表示用整套色板。
   * 档位只影响「可用色号集合」，因此有生成源时重新生成，没有源时对现有图纸重映射——
   * 两条路径都保证成品里不会出现档位外的色号。
   */
  const [kitTier, setKitTier] = useState(0);

  const adapterRef = useRef<StorageAdapter | null>(null);
  const dirtyRef = useRef(false);
  /** 编辑代数：每次置脏 +1；保存完成后仅当代数未变才清脏（避免抹掉保存期间的编辑）。 */
  const editGenRef = useRef(0);
  /**
   * 自动保存防抖句柄（A-15）：以前靠 effect 依赖 [pattern, name, generationDraft] 间接触发，
   * 而判断条件读的是非响应式的 dirtyRef —— 任何「只置脏、不改这三者」的新代码路径都会
   * 静默丢失自动保存。现在由 markDirty 直接排程，置脏与排程是同一个动作。
   */
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doSaveRef = useRef<(() => Promise<boolean>) | null>(null);

  const scheduleAutosave = useCallback((): void => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      if (!dirtyRef.current) return;
      void doSaveRef.current?.();
    }, 1000);
  }, []);

  const markDirty = useCallback((): void => {
    dirtyRef.current = true;
    editGenRef.current += 1;
    setSaveState('dirty');
    scheduleAutosave();
  }, [scheduleAutosave]);

  const previewTabRef = useRef<HTMLButtonElement>(null);
  const editTabRef = useRef<HTMLButtonElement>(null);
  const stitchTabRef = useRef<HTMLButtonElement>(null);
  const TAB_ORDER: Tab[] = useMemo(() => ['preview', 'edit', 'stitch'], []);

  /** 页签键盘导航：←/→ 在预览/修补/跟拼之间循环，焦点跟随（ARIA tabs pattern） */
  const handleTabKey = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = TAB_ORDER.indexOf(tab);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = TAB_ORDER[(current + delta + TAB_ORDER.length) % TAB_ORDER.length];
    setTab(next);
    const refs: Record<Tab, React.RefObject<HTMLButtonElement | null>> = {
      preview: previewTabRef,
      edit: editTabRef,
      stitch: stitchTabRef,
    };
    refs[next].current?.focus();
  }, [TAB_ORDER, tab]);

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

  const restoreDraftControls = useCallback((draft: GenerationDraft): void => {
    // Force a fresh controlled value even when React batches the rejected
    // draft and rollback into one render; otherwise the panel's local draft
    // can remain visible while the parent state bails out by object identity.
    updateGenerationDraft({
      params: { ...draft.params },
      palette: [...draft.palette],
      projectPalette: draft.projectPalette,
    });
    setCustomPaletteId(null);
  }, [updateGenerationDraft]);

  /** 用当前参数在给定源图上重新生成；失败给出可重试提示。
   * 优化票 07：Worker 后台执行（页面不冻结），进度按阶段上报（>300ms 才显示），
   * 可取消（终止 Worker）；token 防旧结果覆盖新结果（取消语义）。 */
  const regenerate = useCallback(
    (): void => {
      startGeneration({
        create: (src, draft, onProgress) => (generateFn ?? runGenerate)({ src, params: draft.params, palette: draft.palette }, onProgress),
        commit: (output, draft) => ({
          ...draft,
          pattern: output.pattern,
          stats: output.stats,
          total: output.totalBeadCount,
          engineVersion: ENGINE_VERSION,
        }),
        errorMessage: t.generateFailed,
        onStart: () => {
          genStartedAtRef.current = performance.now();
          setShowProgress(false);
          setErrorMsg(null);
        },
        onProgress: () => {
          if (performance.now() - genStartedAtRef.current >= 300) setShowProgress(true);
        },
        onSuccess: () => {
          markDirty();
          // D-1：生成完成的可感知反馈（播报 + 三段编排 + 数字滚动）
          setDoneToken((token) => token + 1);
        },
        onFailure: (_error, stableDraft) => {
          if (stableDraft) restoreDraftControls(stableDraft);
        },
        onSettled: () => { setShowProgress(false); },
      });
    },
    [t.generateFailed, markDirty, generateFn, startGeneration, restoreDraftControls],
  );

  /** 取消在途生成任务：作废令牌、终止 Worker，并回滚到生成前的稳定提交态。 */
  const handleCancelGenerate = useCallback((): void => {
    const cancelled = cancelGeneration();
    if (!cancelled) return;
    if (cancelled.stableDraft) restoreDraftControls(cancelled.stableDraft);
    setShowProgress(false);
    if (!cancelled.hadCommit) {
      pendingGenerationSourceRef.current = null;
      uploadGenerationSource(null, initialGenerationDraft);
      setStep('upload');
    }
  }, [cancelGeneration, restoreDraftControls, uploadGenerationSource, initialGenerationDraft]);

  // ---------- 上传/裁剪 ----------

  const handleUpload = useCallback(
    async ({ bytes, type }: ValidImageFile): Promise<void> => {
      setBusy(true);
      setBusyText(t.decoding);
      setErrorMsg(null);
      try {
        // Function injection keeps the old byte-based seam for focused unit
        // tests. Production transfers the encoded source once to the
        // persistent decoder and retains only its opaque source handle.
        const legacyDecode = decodeFn ?? (decodeRegionFn ? decodeImageFile : null);
        const result = legacyDecode
          ? await legacyDecode(bytes, type)
          : await activeImageDecoder.load(bytes, type, () => setBusyText(t.heicConverting));
        if (!result.ok) {
          if (!legacyDecode) activeImageDecoder.clear();
          setErrorMsg(zhCN.errors[result.code]);
          return;
        }
        const pixels = validatePixelCount(
          result.image.naturalWidth ?? result.image.width,
          result.image.naturalHeight ?? result.image.height,
        );
        if (!pixels.ok) {
          if (!legacyDecode) activeImageDecoder.clear();
          setErrorMsg(zhCN.errors[pixels.code]);
          return;
        }
        encodedSourceRef.current = legacyDecode ? { bytes, type } : null;
        setDecoded(result.image);
        setStep('crop');
      } finally {
        setBusy(false);
      }
    },
    [activeImageDecoder, decodeFn, decodeRegionFn, t.decoding, t.heicConverting],
  );

  // 首次生成完成时把焦点移到图纸区（D-1）：键盘/读屏用户直接落在结果上。
  // 只做第一次——之后每次调参都抢焦点会打断正在操作参数的用户。
  useEffect(() => {
    if (doneToken === 0 || firstDoneHandledRef.current) return;
    firstDoneHandledRef.current = true;
    patternRegionRef.current?.focus();
  }, [doneToken]);

  // 首页落图后带过来的文件（D-3）：客户端导航期间模块单例存活，取一次即清空。
  // 放到宏任务里执行，避免在 effect 体内同步 setState 触发级联渲染。
  useEffect(() => {
    const handed = takePendingUpload();
    if (!handed) return;
    const timer = setTimeout(() => { void handleUpload(handed); }, 0);
    return () => clearTimeout(timer);
  }, [handleUpload]);

  const handleCropConfirm = useCallback(
    async (rect: Rect): Promise<void> => {
      if (!decoded) return;
      setBusy(true);
      setBusyText(t.decoding);
      setErrorMsg(null);
      let cropped: ImageDataLike;
      try {
        const legacyDecoder = Boolean(decodeFn || decodeRegionFn);
        const encoded = encodedSourceRef.current;
        if (!legacyDecoder) {
          const result = await activeImageDecoder.region(rect, MAX_GENERATION_SOURCE_DIMENSION);
          if (!result.ok) {
            setErrorMsg(zhCN.errors[result.code]);
            return;
          }
          cropped = result.image;
        } else if (encoded && decodeRegionFn) {
          const result = await decodeRegionFn(encoded.bytes, encoded.type, rect, MAX_GENERATION_SOURCE_DIMENSION);
          if (!result.ok) {
            setErrorMsg(zhCN.errors[result.code]);
            return;
          }
          cropped = result.image;
        } else {
          // Unit/custom-decoder compatibility: map natural crop coordinates
          // back to the bounded RGBA buffer supplied by the injected decoder.
          const naturalWidth = decoded.naturalWidth ?? decoded.width;
          const naturalHeight = decoded.naturalHeight ?? decoded.height;
          cropped = cropImageData(decoded, {
            x: (rect.x * decoded.width) / naturalWidth,
            y: (rect.y * decoded.height) / naturalHeight,
            width: (rect.width * decoded.width) / naturalWidth,
            height: (rect.height * decoded.height) / naturalHeight,
          }, MAX_GENERATION_SOURCE_DIMENSION);
        }
      } finally {
        setBusy(false);
      }
      // Keep one immutable cross-thread RGBA allocation for the entire
      // generation session; subsequent parameter changes send only params.
      cropped = prepareGenerationSource(cropped);
      pendingGenerationSourceRef.current = cropped;
      setDecoded(null);
      encodedSourceRef.current = null;
      activeImageDecoder.clear();
      const rebindRestoredSource = rebindRestoredSourceRef.current;
      if (!rebindRestoredSource) setCreatedAt(new Date().toISOString());
      const draft = { params, palette, projectPalette };
      if (rebindRestoredSource) {
        reuploadGenerationSource(cropped, draft);
        // 绑定生成源本身就是可持久化变更；即使随后取消或生成失败，刷新也不应再次锁定。
        markDirty();
      } else uploadGenerationSource(cropped, draft);
      regenerate();
      setStep('workspace');
      rebindRestoredSourceRef.current = false;
      if (!rebindRestoredSource) {
        clearDesignQuery(); // 普通上传生成新设计；恢复项目的原图重绑保留原 id。
      }
    },
    [activeImageDecoder, decodeFn, decodeRegionFn, decoded, markDirty, params, palette, projectPalette, regenerate, reuploadGenerationSource, uploadGenerationSource, t.decoding],
  );

  const handleCropCancel = useCallback((): void => {
    setDecoded(null);
    encodedSourceRef.current = null;
    activeImageDecoder.clear();
    setErrorMsg(null);
    if (rebindRestoredSourceRef.current) {
      rebindRestoredSourceRef.current = false;
      setStep('workspace');
    } else {
      setStep('upload');
    }
  }, [activeImageDecoder]);

  // ---------- 参数/色板/编辑 ----------

  const confirmRegeneration = useCallback(async (): Promise<boolean> => {
    if (!generationSession.hasManualEdits) return true;
    return confirm({
      title: t.confirmRegenerateTitle,
      message: t.confirmRegenerate,
      confirmLabel: t.confirmRegenerateAction,
      danger: true,
    });
  }, [confirm, generationSession.hasManualEdits, t.confirmRegenerate, t.confirmRegenerateAction, t.confirmRegenerateTitle]);

  const handleParamsChange = useCallback(
    (p: GenerationParams): void => {
      if (!source) return;
      void (async () => {
        if (!(await confirmRegeneration())) {
          // Give the debounced panel a new controlled value identity so its draft
          // is reset to the last committed parameters.
          restoreDraftControls(generationDraft);
          return;
        }
        updateGenerationDraft({ ...generationDraft, params: p });
        regenerate();
      })();
    },
    [source, generationDraft, regenerate, confirmRegeneration, restoreDraftControls, updateGenerationDraft],
  );

  /**
   * 换色板（H-1）。
   *
   * 两条路径，规则是「永不丢用户的工作」：
   * - 图纸已有手工修补，或没有本地生成源（导入的项目文件、换设备打开的云端设计）
   *   → 图纸级重映射：逐格换成新色板最近色，位置与修补全部保留，一步可撤销。
   *   这也修掉了此前「没有生成源就根本换不了色板」的死路。
   * - 既没有修补又有生成源 → 用新色板重新采样原图（色彩还原度更好，且无工作可丢）。
   */
  const handlePaletteSelect = useCallback(
    (value: string): void => {
      if (value === '__custom') return; // 导入的自定义色板不可再切换（T18 提供管理）
      const resolved = ((): { palette: PaletteColor[]; projectPalette: ProjectPalette; customId: string | null } | null => {
        if (value.startsWith('custom:')) {
          const paletteId = value.slice('custom:'.length);
          const found = cloudPalettes.find((p) => p.id === paletteId);
          if (!found) return null;
          return {
            palette: found.colors,
            projectPalette: {
              kind: 'custom',
              colors: found.colors.map((c) => ({ code: c.code ?? '', hex: c.hex })),
            },
            customId: found.id,
          };
        }
        const brand = value as Brand;
        return { palette: buildBrandPalette(brand), projectPalette: { kind: 'builtin', brand }, customId: null };
      })();
      if (!resolved) return;

      const committed = generationSession.committed;
      const useRemap = committed !== null && (generationSession.hasManualEdits || !source);
      if (useRemap) {
        setCustomPaletteId(resolved.customId);
        const result = remapPattern(committed.pattern, resolved.palette);
        remapPalette({
          pattern: result.pattern,
          stats: result.stats,
          total: result.totalBeadCount,
          palette: resolved.palette,
          projectPalette: resolved.projectPalette,
        });
        setRemapNotice(t.remapDone(result.changedCells));
        markDirty();
        return;
      }
      if (!source) return;
      setCustomPaletteId(resolved.customId);
      updateGenerationDraft({ params, palette: resolved.palette, projectPalette: resolved.projectPalette });
      regenerate();
    },
    [
      cloudPalettes,
      generationSession.committed,
      generationSession.hasManualEdits,
      markDirty,
      params,
      regenerate,
      remapPalette,
      source,
      t,
      updateGenerationDraft,
    ],
  );

  const handlePatternChange = useCallback((p: Pattern): void => {
    if (generating) return;
    const nextStats = computeStats(p.cells);
    const nextTotal = totalBeadCount(nextStats);
    commitManualEdit(p, nextStats, nextTotal);
    markDirty();
  }, [commitManualEdit, generating, markDirty]);

  /**
   * 空白起稿（H-2）：不经过上传与生成，直接把一张全透明图纸提交进会话。
   * 没有生成源，因此参数面板保持锁定（改参数需要原图），但可以修补、换色板、导出。
   */
  const startBlank = useCallback((width: number, height: number): void => {
    const blank = createBlankPattern(width, height);
    restoreGeneration({
      params: { ...params, targetWidth: width },
      palette,
      projectPalette,
      pattern: blank,
      stats: [],
      total: 0,
      engineVersion: ENGINE_VERSION,
    });
    setStep('workspace');
    setTab('edit'); // 空白图纸的第一步一定是画，直接落在修补页签
    markDirty();
  }, [markDirty, palette, params, projectPalette, restoreGeneration]);

  /**
   * 换档位（H-3）：把当前色板按档位裁成可用色子集后应用。
   * 有生成源 → 用子集重新生成；没有源 → 对现有图纸重映射（保留修补）。
   */
  const handleKitTierChange = useCallback((tier: number): void => {
    setKitTier(tier);
    const full = paletteKind.kind === 'builtin'
      ? buildBrandPalette(paletteKind.brand)
      : palette;
    const kit = selectKitColors(full, tier);
    const committed = generationSession.committed;
    if (source) {
      updateGenerationDraft({ params, palette: kit, projectPalette });
      regenerate();
      return;
    }
    if (!committed) return;
    const result = remapPattern(committed.pattern, kit);
    remapPalette({
      pattern: result.pattern,
      stats: result.stats,
      total: result.totalBeadCount,
      palette: kit,
      projectPalette,
    });
    setRemapNotice(t.kitApplied(tier, result.changedCells));
    markDirty();
  }, [
    generationSession.committed,
    markDirty,
    palette,
    paletteKind,
    params,
    projectPalette,
    regenerate,
    remapPalette,
    source,
    t,
    updateGenerationDraft,
  ]);

  const handleUndoRegeneration = useCallback((): void => {
    const snapshot = generationSession.regenerationUndo;
    if (!snapshot || generating) return;
    undoRegeneration();
    setCustomPaletteId(null);
    setRemapNotice(null);
    markDirty();
  }, [generationSession.regenerationUndo, generating, markDirty, undoRegeneration]);

  // ---------- 保存 ----------

  const buildProject = useCallback((): ProjectFile | null => {
    const committed = selectCommittedSnapshot(generationSession);
    if (!committed) return null;
    return {
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      engineVersion: committed.engineVersion,
      name: name.trim() || zhCN.project.unnamed,
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      palette: committed.projectPalette,
      params: committed.params,
      pattern: committed.pattern,
    };
  }, [generationSession, name, createdAt]);
  const buildProjectRef = useRef(buildProject);
  useEffect(() => {
    buildProjectRef.current = buildProject;
  }, [buildProject]);

  const loadCommittedProject = useCallback((project: ProjectFile, localSource: LocalGenerationSourceV1 | null = null): void => {
    const restoredPalette = project.palette.kind === 'builtin'
      ? buildBrandPalette(project.palette.brand)
      : project.palette.colors.map((color) => ({ hex: color.hex, code: color.code || null }));
    const computed = computeStats(project.pattern.cells);
    const restoredTotal = totalBeadCount(computed);
    const commit = {
      params: project.params,
      palette: restoredPalette,
      projectPalette: project.palette,
      pattern: project.pattern,
      stats: computed,
      total: restoredTotal,
      engineVersion: project.engineVersion,
    };
    setName(project.name);
    setCreatedAt(project.createdAt);
    setDecoded(null);
    encodedSourceRef.current = null;
    activeImageDecoder.clear();
    setCustomPaletteId(null);
    restoreGeneration(commit);
    if (localSource) {
      const restoredSource = prepareGenerationSource(imageDataFromLocalGenerationSource(localSource));
      reuploadGenerationSource(restoredSource, commit);
    }
    pendingGenerationSourceRef.current = null;
    dirtyRef.current = false;
    setSaveState('saved');
    setStep('workspace');
  }, [activeImageDecoder, restoreGeneration, reuploadGenerationSource]);

  const consumeSyncOutcome = useCallback(async (adapter: StorageAdapter, outcome: SyncOutcome): Promise<void> => {
      const activeId = designIdRef.current;
      const conflict = outcome.conflictCopies.find((item) => item.originalId === activeId);
      if (conflict) {
        const conflictRecord = (await adapter.getAll()).find((item) => item.id === conflict.conflictId);
        const conflictProject = conflictRecord ? parseStoredProject(conflictRecord.projectJson) : null;
        // If the UI acquired another unsaved edit after the storage snapshot,
        // fold that latest committed view into the already-created conflict id.
        const currentProject = dirtyRef.current ? buildProjectRef.current() : null;
        if (currentProject && conflictProject) {
          const latestProject = { ...currentProject, name: conflictProject.name, updatedAt: new Date().toISOString() };
          await adapter.put({
            ...createDesignRecord(conflict.conflictId, latestProject, renderThumbnail(latestProject.pattern, 256)),
            syncState: 'conflict',
          }, source
            ? replaceGenerationSource(createLocalGenerationSource(source))
            : undefined);
          if (pendingGenerationSourceRef.current === source) pendingGenerationSourceRef.current = null;
        }
        setActiveDesignId(conflict.conflictId);
        if (conflictProject) setName(conflictProject.name);
        window.history.replaceState(null, '', `/app?id=${encodeURIComponent(conflict.conflictId)}`);
        setSyncNotice(t.syncConflictCopy);
        setCloudSaveState('pending');
        return;
      }
      if (outcome.overwrittenByCloud.includes(activeId)) {
        const record = (await adapter.getAll()).find((item) => item.id === activeId);
        if (dirtyRef.current) {
          const currentProject = buildProjectRef.current();
          if (currentProject) {
            const records = await adapter.getAll();
            const conflictId = newDesignId();
            const conflictProjectName = conflictName(t.conflictCopyName(currentProject.name), records.map((item) => item.name));
            const conflictProject = { ...currentProject, name: conflictProjectName, updatedAt: new Date().toISOString() };
            await adapter.put({
              ...createDesignRecord(conflictId, conflictProject, renderThumbnail(conflictProject.pattern, 256)),
              syncState: 'conflict',
            }, source
              ? replaceGenerationSource(createLocalGenerationSource(source))
              : undefined);
            if (pendingGenerationSourceRef.current === source) pendingGenerationSourceRef.current = null;
            setActiveDesignId(conflictId);
            setName(conflictProjectName);
            window.history.replaceState(null, '', `/app?id=${encodeURIComponent(conflictId)}`);
            dirtyRef.current = false;
            setSaveState('saved');
            setSyncNotice(t.syncConflictCopy);
            setCloudSaveState('pending');
            return;
          }
        }
        const remoteProject = record ? parseStoredProject(record.projectJson) : null;
        if (remoteProject) {
          const localSource = await adapter.getGenerationSource(activeId);
          loadCommittedProject(remoteProject, localSource);
          setSyncNotice(t.syncCloudUpdated);
        } else {
          // A clean active design was deleted on another device.
          pendingGenerationSourceRef.current = null;
          setActiveDesignId(newDesignId());
          uploadGenerationSource(null, initialGenerationDraft);
          setStep('upload');
          clearDesignQuery();
          setSyncNotice(t.syncCloudDeleted);
        }
      }
      setCloudSaveState('synced');
  }, [initialGenerationDraft, loadCommittedProject, setActiveDesignId, source, t, uploadGenerationSource]);

  const syncCloud = useCallback(async (adapter: StorageAdapter): Promise<void> => {
    if (authStatus.kind !== 'user') return;
    setCloudSaveState('syncing');
    try {
      const outcome = await enqueueDesignSync(
        adapter,
        createDoupuApi(),
        (current) => consumeSyncOutcome(adapter, current),
      );
      if (!outcome) setCloudSaveState('pending');
    } catch {
      // 本地保存已经成功；durable marker 会留到 online 或下次启动重试。
      setCloudSaveState('pending');
    }
  }, [authStatus.kind, consumeSyncOutcome]);

  const doSave = useCallback(async (): Promise<boolean> => {
    const adapter = adapterRef.current;
    if (!adapter) {
      setSaveState('unavailable');
      return false;
    }
    const project = buildProject();
    if (!project) return false;
    const saveDesignId = designIdRef.current;
    const pendingSource = pendingGenerationSourceRef.current;
    const genBefore = editGenRef.current;
    setSaveState('saving');
    try {
      const thumbnail = renderThumbnail(project.pattern, 256);
      await withDesignStorageLock(async () => {
        const shouldWriteSource = pendingSource !== null
          && pendingGenerationSourceRef.current === pendingSource
          && designIdRef.current === saveDesignId;
        await adapter.put(
          createDesignRecord(saveDesignId, project, thumbnail),
          shouldWriteSource
            ? replaceGenerationSource(createLocalGenerationSource(pendingSource))
            : undefined,
        );
        if (shouldWriteSource && pendingGenerationSourceRef.current === pendingSource) {
          pendingGenerationSourceRef.current = null;
        }
      });
      // Local persistence is authoritative. Cloud sync is durable, coalesced,
      // and deliberately cannot turn an offline cloud into a failed save.
      void syncCloud(adapter);
      setSavedNames((prev) => (prev.includes(project.name) ? prev : [...prev, project.name]));
      // 仅当保存期间没有新的编辑才清脏；否则保持脏标记（自动保存会再兜底一次）
      if (editGenRef.current === genBefore) {
        dirtyRef.current = false;
        setSaveState('saved');
      } else {
        setSaveState('dirty');
      }
      return true;
    } catch (error) {
      setSaveState(isQuotaError(error) ? 'quota' : 'error');
      return false;
    }
  }, [buildProject, syncCloud]);

  /**
   * 分享前的准备（批次 K）：把当前设计**确实**保存并推到云端。
   *
   * 为什么不用「云端：已同步」徽标做判断：那个状态表示上一次同步跑完了，
   * 一张刚生成、还没落盘的设计也会显示已同步——实测点分享会得到「设计不存在」。
   * 这里直接走一遍保存 + 同步，再由服务端的查询结果说话。
   */
  const prepareShare = useCallback(async (): Promise<boolean> => {
    const adapter = adapterRef.current;
    if (!adapter || authStatus.kind !== 'user') return false;
    if (dirtyRef.current || saveState !== 'saved') {
      const saved = await doSave();
      if (!saved) return false;
    }
    // doSave 内部会触发一次同步，但它是 fire-and-forget；这里显式等一次，
    // 保证 POST /share 之前云端已经有这张设计。
    await syncCloud(adapter);
    return true;
  }, [authStatus.kind, doSave, saveState, syncCloud]);

  // 登录工作台启动时先恢复 durable pending；网络恢复后在当前页面自动重试。
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!storageReady || authStatus.kind !== 'user' || !adapter) return;
    const retry = (): void => { void syncCloud(adapter); };
    retry();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [authStatus.kind, storageReady, syncCloud]);

  // 自动保存：置脏后 1s 防抖（spec §F8）。排程在 markDirty 里完成；
  // 这里只负责保持 doSave 引用最新，并在卸载时清掉未触发的定时器。
  useEffect(() => {
    doSaveRef.current = step === 'workspace' ? doSave : null;
  }, [doSave, step]);

  /**
   * 跟拼进度的读取（G-1）：设计或图纸尺寸变化时重新对齐。
   * 尺寸不匹配（重新生成或旋转过）就从零开始——把旧标记套到新图纸上会错位。
   */
  useEffect(() => {
    if (!storageReady || !pattern) return;
    const adapter = adapterRef.current;
    if (!adapter) {
      setStitchProgress(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const stored = await adapter.getStitchProgress(designId);
        if (cancelled) return;
        setStitchProgress(
          isProgressCompatible(stored, pattern)
            ? stored
            : createStitchProgress(pattern.width, pattern.height),
        );
      } catch {
        if (!cancelled) setStitchProgress(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [designId, pattern, storageReady]);

  /** 跟拼进度写入：300ms 防抖（连点格子不该每次都写库）。 */
  const updateStitchProgress = useCallback((next: StitchProgress): void => {
    setStitchProgress(next);
    const adapter = adapterRef.current;
    if (!adapter) return;
    const id = designIdRef.current;
    if (stitchSaveTimerRef.current) clearTimeout(stitchSaveTimerRef.current);
    stitchSaveTimerRef.current = setTimeout(() => {
      stitchSaveTimerRef.current = null;
      void adapter.putStitchProgress(id, next).catch(() => {
        // 进度写入失败不阻断跟拼（图纸本身不受影响）；下一次改动会再试。
      });
    }, 300);
  }, []);

  useEffect(() => () => {
    if (stitchSaveTimerRef.current) clearTimeout(stitchSaveTimerRef.current);
  }, []);

  useEffect(() => () => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
  }, []);

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
    // The public configuration is loaded asynchronously and is the source of
    // truth for a fresh upload draft.
    if (step === 'upload' && !rebindRestoredSourceRef.current) updateGenerationDraft(initialGenerationDraft);
  }, [step, initialGenerationDraft, updateGenerationDraft]);

  // 卸载时作废在途任务。调用方注入的图片解码器不在本组件中销毁。
  useEffect(() => {
    return () => {
      disposeGenerateWorker();
      if (!imageDecoder) ownedImageDecoder.dispose();
    };
  }, [imageDecoder, ownedImageDecoder]);

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
        setStorageReady(Boolean(adapter));
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
        const localSource = await adapter.getGenerationSource(last.id);
        if (cancelled) return;
        setActiveDesignId(last.id);
        setSavedNames(records.map((r) => r.name));
        loadCommittedProject(project, localSource);
      } catch {
        adapterRef.current = null;
        setStorageReady(false);
        setSaveState('unavailable');
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [loadCommittedProject, setActiveDesignId, storage]);

  // ---------- 导入 ----------

  const handleImport = useCallback(
    (project: ProjectFile): void => {
      rebindRestoredSourceRef.current = false;
      pendingGenerationSourceRef.current = null;
      cancelGeneration();
      disposeGenerateWorker();
      setShowProgress(false);
      encodedSourceRef.current = null;
      activeImageDecoder.clear();
      setActiveDesignId(newDesignId());
      setName(project.name);
      setCreatedAt(project.createdAt);
      const computed = computeStats(project.pattern.cells);
      const importedTotal = totalBeadCount(computed);
      setCustomPaletteId(null);
      const importedPalette = project.palette.kind === 'builtin'
        ? buildBrandPalette(project.palette.brand)
        : project.palette.colors.map((c) => ({ hex: c.hex, code: c.code || null }));
      const importedCommit = {
        params: project.params,
        palette: importedPalette,
        projectPalette: project.palette,
        pattern: project.pattern,
        stats: computed,
        total: importedTotal,
        engineVersion: project.engineVersion,
      };
      restoreGeneration(importedCommit);
      setErrorMsg(null);
      markDirty();
      setStep('workspace');
      clearDesignQuery(); // 新设计不再对应 URL ?id= 的旧设计（否则刷新会恢复错对象）
    },
    [activeImageDecoder, cancelGeneration, markDirty, restoreGeneration, setActiveDesignId],
  );

  const resetWorkbench = useCallback((): void => {
    rebindRestoredSourceRef.current = false;
    pendingGenerationSourceRef.current = null;
    cancelGeneration();
    disposeGenerateWorker();
    setShowProgress(false);
    dirtyRef.current = false;
    setStep('upload');
    setDecoded(null);
    encodedSourceRef.current = null;
    activeImageDecoder.clear();
    setErrorMsg(null);
    setActiveDesignId(newDesignId());
    setName('');
    setCreatedAt('');
    setCustomPaletteId(null);
    uploadGenerationSource(null, initialGenerationDraft);
    clearDesignQuery();
  }, [activeImageDecoder, cancelGeneration, initialGenerationDraft, setActiveDesignId, uploadGenerationSource]);

  /** Flush dirty state before an in-app transition. Only a failed flush asks
   * the user whether to discard the unsaved work. */
  const saveBeforeLeave = useCallback(async (leave: () => void): Promise<void> => {
    if (!dirtyRef.current) {
      leave();
      return;
    }
    const saved = await doSave();
    if (saved && !dirtyRef.current) {
      leave();
      return;
    }
    if (await confirm({
      title: t.confirmLeaveTitle,
      message: t.confirmLeave,
      confirmLabel: t.confirmLeaveAction,
      danger: true,
    })) leave();
  }, [confirm, doSave, t.confirmLeave, t.confirmLeaveAction, t.confirmLeaveTitle]);

  const handleNavigationClick = useCallback((event: MouseEvent<HTMLAnchorElement>, href: string): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void saveBeforeLeave(() => router.push(href));
  }, [router, saveBeforeLeave]);

  const handleRestart = useCallback((): void => {
    const leave = generationSession.status === 'restored-locked'
      ? () => {
          rebindRestoredSourceRef.current = true;
          setDecoded(null);
          encodedSourceRef.current = null;
          activeImageDecoder.clear();
          setErrorMsg(null);
          setStep('upload');
        }
      : resetWorkbench;
    void saveBeforeLeave(leave);
  }, [activeImageDecoder, generationSession.status, resetWorkbench, saveBeforeLeave]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <SiteHeader
        title={t.title}
        currentPath="/app"
        onNavigate={handleNavigationClick}
        context={step === 'workspace' ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <DesignNameEditor name={name} onChange={(nextName) => { setName(nextName); markDirty(); }} />
            <span className="shrink-0 text-xs text-ink-soft/80">
              {paletteKind.kind === 'builtin' ? paletteKind.brand : zhCN.workbench.customPaletteLabel}
            </span>
          </div>
        ) : undefined}
        primaryActions={step === 'workspace' ? (
          <SaveStatus
            state={saveState}
            cloudState={cloudSaveState}
            loggedIn={authStatus.kind === 'user'}
            onSave={() => { void doSave(); }}
            disabled={generating || !generationSession.committed}
          />
        ) : undefined}
        overflowActions={step === 'workspace' ? (
          <>
            {authStatus.kind === 'guest' ? (
              <>
                <Link href="/login" className="link-soft" onClick={(event) => handleNavigationClick(event, '/login')}>
                  {zhCN.nav.login}
                </Link>
                <Link href="/register" className="link-soft" onClick={(event) => handleNavigationClick(event, '/register')}>
                  {zhCN.nav.register}
                </Link>
              </>
            ) : (
              <span className="max-w-[160px] truncate text-sm text-ink-soft" title={authStatus.email}>
                {authStatus.email}
              </span>
            )}
            <button type="button" onClick={handleRestart} className="btn-outline px-3 py-1 text-sm">
              {t.restart}
            </button>
          </>
        ) : undefined}
      />

      {/* 三步位置提示（D-2）：上传/裁剪页最需要，工作台阶段也保留一行让路径可见。 */}
      <StepIndicator step={step} />

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
      {saveState === 'unavailable' && <Notice kind="warning">{t.unavailable}</Notice>}
      {/* 配额不足此前只体现在头部徽标文字里（现已缩短），必须在正文说清怎么办（D-8）。 */}
      {saveState === 'quota' && <Notice kind="danger">{t.quotaError}</Notice>}
      {visibleErrorMsg && <Notice kind="danger">{visibleErrorMsg}</Notice>}
      {syncNotice && <Notice kind="warning">{syncNotice}</Notice>}

      {step === 'upload' && (
        <>
          <UploadDropzone onValid={(file) => void handleUpload(file)} disabled={busy} capture />
          {/*
            空白起稿（H-2）：此前进工作台的唯一入口是「上传一张图」，
            想从零摆一个像素图案（照着别人的图纸摆、画图标或文字）没有任何入口。
          */}
          <section aria-label={t.blankTitle} className="card-surface flex flex-col gap-2 p-3 text-sm">
            <p className="font-medium text-ink">{t.blankTitle}</p>
            <p className="text-xs text-ink-soft">{t.blankHint}</p>
            <div className="flex flex-wrap items-center gap-2">
              {BLANK_PRESETS.map((boards) => (
                <button
                  key={boards}
                  type="button"
                  onClick={() => startBlank(boards * BOARD_SIZE, boards * BOARD_SIZE)}
                  disabled={busy}
                  className="btn-outline btn-sm"
                >
                  {t.blankPreset(boards, boards * BOARD_SIZE)}
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {step === 'crop' && decoded && (
        <ImageCropper image={decoded} onConfirm={handleCropConfirm} onCancel={handleCropCancel} />
      )}

      {step === 'workspace' && pattern && (
        // D-6：768–1023px（iPad 竖屏）此前只有 lg 断点，参数与导出全被挤到图纸下方，
        // 需要滚很远才能改参数。md 起就并列两栏，侧栏在该区间收窄到 260px。
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_260px] lg:grid-cols-[1fr_320px]">
          <section className="flex flex-col gap-3">
            {/*
              生成完成的结果句（D-1 第一段）：礼貌播报 + 上浮出现。
              以前生成完成没有任何反馈——进度行消失、图纸静默替换，用户不确定是否已完成。
            */}
            {doneToken > 0 && !generating && (
              <p
                key={doneToken}
                role="status"
                className="animate-rise text-sm font-medium text-success"
              >
                {t.generateDone(pattern.width, pattern.height, total, stats.length)}
              </p>
            )}
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
              <button
                ref={stitchTabRef}
                type="button"
                id="tab-stitch"
                role="tab"
                aria-selected={tab === 'stitch'}
                aria-controls="panel-stitch"
                tabIndex={tab === 'stitch' ? 0 : -1}
                onClick={() => setTab('stitch')}
                className={`rounded-full px-3 py-1 transition-colors ${tab === 'stitch' ? 'bg-primary text-white' : 'text-ink-soft hover:bg-primary-soft'}`}
              >
                {zhCN.stitch.tab}
              </button>
            </div>
            {tab === 'preview' && (
              <div
                id="panel-preview"
                role="tabpanel"
                aria-labelledby="tab-preview"
                ref={patternRegionRef}
                tabIndex={-1}
              >
                {/*
                  这里刻意不做「图纸淡入」动效：淡入需要重挂载才能重播，而重挂载会
                  把用户的缩放、网格/板缝/色号开关全部重置——每次调参都丢一次视图状态，
                  代价远大于一个 400ms 的动效。完成感由上方结果句的上浮与数字滚动承担。
                */}
                <PatternPreview
                  pattern={pattern}
                  onCellHover={(info) =>
                    setHoverInfo(info ? zhCN.preview.cellInfo(info.row, info.col, info.cell.code) : null)
                  }
                />
              </div>
            )}
            {tab === 'edit' && (
              <div id="panel-edit" role="tabpanel" aria-labelledby="tab-edit">
                <div className={generating ? 'pointer-events-none opacity-60' : undefined} aria-busy={generating}>
                  <PixelEditorCanvas
                    pattern={pattern}
                    palette={palette}
                    autoFocus
                    onPatternChange={handlePatternChange}
                  />
                </div>
              </div>
            )}
            {tab === 'stitch' && (
              <div id="panel-stitch" role="tabpanel" aria-labelledby="tab-stitch">
                {stitchProgress ? (
                  <StitchView pattern={pattern} progress={stitchProgress} onChange={updateStitchProgress} />
                ) : (
                  <Notice kind="warning">{zhCN.stitch.unavailable}</Notice>
                )}
              </div>
            )}
            {hoverInfo && tab === 'preview' && (
              <p role="status" className="rounded-lg bg-ink px-2 py-1 text-xs text-white">
                {hoverInfo}
              </p>
            )}
            <p className="text-xs text-ink-soft/80">{t.editorHint}</p>
            {generationSession.regenerationUndo && !generating && (
              <button
                type="button"
                onClick={handleUndoRegeneration}
                className="self-start btn-outline btn-sm"
              >
                {t.undoRegeneration}
              </button>
            )}
          </section>

          <aside className="flex flex-col gap-4">
            {generationSession.status === 'restored-locked' && (
              <Notice kind="warning">{t.sourceRequired}</Notice>
            )}
            {paletteLoadFailed && (
              <Notice kind="warning" compact>{t.paletteLoadFailed}</Notice>
            )}
            {remapNotice && <Notice kind="success" compact>{remapNotice}</Notice>}
            <GenerationParamsPanel
              params={params}
              paletteOptions={paletteOptions}
              selectedPalette={selectedPalette}
              onParamsChange={handleParamsChange}
              onPaletteSelect={handlePaletteSelect}
              backgroundSampleSource={source}
              disabled={!source || generating}
              /* 换色板不需要原图（H-1）：只要有已提交的图纸就能重映射。 */
              paletteDisabled={generating || !generationSession.committed}
              kitTier={kitTier}
              onKitTierChange={handleKitTierChange}
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

            {generationSession.committed && (
              <ShoppingListPanel
                stats={stats}
                designName={name.trim() || zhCN.project.unnamed}
                width={pattern.width}
                height={pattern.height}
              />
            )}

            {generationSession.committed && (
              <div className="card-surface flex flex-col gap-3 p-3">
                <PngExportButton
                  pattern={generationSession.committed.pattern}
                  designName={name.trim() || zhCN.project.unnamed}
                  disabled={generating}
                />
                <PdfExportButton
                  name={name.trim() || zhCN.project.unnamed}
                  pattern={generationSession.committed.pattern}
                  stats={generationSession.committed.stats}
                  disabled={generating}
                />
                <ProjectFileButtons
                  source={{
                    name: name.trim() || zhCN.project.unnamed,
                    createdAt: createdAt || new Date().toISOString(),
                    engineVersion: generationSession.committed.engineVersion,
                    palette: generationSession.committed.projectPalette,
                    params: generationSession.committed.params,
                    pattern: generationSession.committed.pattern,
                  }}
                  existingNames={savedNames}
                  onImport={handleImport}
                  disabled={generating}
                />
                {/* 只读分享（K）：需要登录且已同步云端，否则链接打不开 */}
                <ShareButton
                  designId={designId}
                  onBeforeShare={prepareShare}
                  disabled={authStatus.kind !== 'user'}
                  disabledReason={zhCN.share.requiresCloud}
                />
              </div>
            )}
          </aside>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
