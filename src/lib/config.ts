/**
 * 站点配置（优化票 02，决策 D32）：所有「改配置即生效」参数的单一出口。
 *
 * - 服务端（Node 运行时）读取环境变量；浏览器端无 process.env → 回退默认值。
 * - 客户端可见的公开子集经 GET /api/config 下发（服务端运行时值），
 *   由 usePublicConfig() 消费：改 .env + 重启容器即生效，无需改代码重新发版。
 * - 值非法（非整数/越界）时回退默认值并在服务端告警。
 * - 敏感项（限流/会话/体积）绝不出现在 publicConfig() 中。
 */
import { LIMITS } from '@/lib/appInfo';
import { A4_HEIGHT_MM, A4_WIDTH_MM } from '@/lib/paper';

const isServer = typeof process !== 'undefined' && process.versions?.node != null;

function readInt(name: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!isServer) return fallback;
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    console.warn(`[config] 环境变量 ${name}=${raw} 非法，回退默认 ${fallback}`);
    return fallback;
  }
  return value;
}

function readBool(name: string, fallback: boolean): boolean {
  if (!isServer) return fallback;
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

/** 客户端可见配置（经 /api/config 下发）。 */
export interface PublicConfig {
  generation: {
    /** 生成默认目标宽度（格） */
    defaultWidth: number;
    /** 生成默认颜色数 */
    defaultColorCount: number;
  };
  exportPng: {
    /** PNG 每格像素 */
    cellPx: number;
    /** 是否裁剪至内容 */
    cropToContent: boolean;
    /** 是否包含图例 */
    includeLegend: boolean;
  };
  exportPdf: {
    /** 每格毫米 */
    cellMm: number;
    /** 页边距毫米 */
    marginMm: number;
    /** 页眉高度毫米 */
    headerMm: number;
    /** 每页列数 */
    pageCols: number;
    /** 每页行数 */
    pageRows: number;
  };
}

export interface SiteConfig extends PublicConfig {
  security: {
    loginRateLimit: number;
    registerRateLimit: number;
    tokenRateLimit: number;
    /** 同步写（设计/色板 PUT+DELETE）每用户每小时上限 */
    syncWriteRateLimit: number;
    /** 备份告警端点每 IP 每小时上限 */
    backupAlertRateLimit: number;
    /** 匿名分析摄取每个短期 IP HMAC 键每小时上限 */
    analyticsRateLimit: number;
    sessionTtlSeconds: number;
    maxBodyBytes: number;
  };
  /** 生产连接池韧性：任一项为 0 表示不设该超时（不推荐）。 */
  database: {
    poolMax: number;
    statementTimeoutMs: number;
    connectionTimeoutMs: number;
    idleTimeoutMs: number;
  };
}

/** 默认值即历史行为：未配置任何环境变量时，站点行为与优化前完全一致。 */
const DEFAULTS: SiteConfig = {
  generation: { defaultWidth: 100, defaultColorCount: 40 },
  exportPng: { cellPx: 24, cropToContent: true, includeLegend: false },
  exportPdf: { cellMm: 6, marginMm: 8, headerMm: 10, pageCols: 31, pageRows: 45 },
  security: {
    loginRateLimit: 10,
    registerRateLimit: 10,
    tokenRateLimit: 60,
    syncWriteRateLimit: 600,
    backupAlertRateLimit: 60,
    analyticsRateLimit: 300,
    sessionTtlSeconds: 30 * 24 * 60 * 60,
    maxBodyBytes: 64 * 1024,
  },
  database: {
    poolMax: 10,
    statementTimeoutMs: 15_000,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 30_000,
  },
};

/** PDF 版式参数必须作为整组落在 A4 可见区内，否则整组回退。 */
export function normalizePdfMetrics(
  candidate: PublicConfig['exportPdf'],
  fallback: PublicConfig['exportPdf'],
): PublicConfig['exportPdf'] {
  const fieldsAreValid = Number.isFinite(candidate.cellMm)
    && Number.isFinite(candidate.marginMm)
    && Number.isFinite(candidate.headerMm)
    && candidate.cellMm > 0
    && candidate.marginMm > 0
    && candidate.headerMm > 0
    && Number.isInteger(candidate.pageCols)
    && Number.isInteger(candidate.pageRows)
    && candidate.pageCols > 0
    && candidate.pageRows > 0;
  // A4 尺寸常量与 export/pdfLayout.ts 共用（J-3：此前两处各自硬编码 210/297）。
  const fitsWidth = 2 * candidate.marginMm + candidate.pageCols * candidate.cellMm <= A4_WIDTH_MM;
  const fitsHeight = 2 * candidate.marginMm + candidate.headerMm + candidate.pageRows * candidate.cellMm <= A4_HEIGHT_MM;
  return { ...(fieldsAreValid && fitsWidth && fitsHeight ? candidate : fallback) };
}

function compute(): SiteConfig {
  const exportPdf = normalizePdfMetrics(
    {
      cellMm: readInt('PDF_CELL_MM', DEFAULTS.exportPdf.cellMm, 2, 20),
      marginMm: readInt('PDF_MARGIN_MM', DEFAULTS.exportPdf.marginMm, 2, 30),
      headerMm: readInt('PDF_HEADER_MM', DEFAULTS.exportPdf.headerMm, 4, 30),
      pageCols: readInt('PDF_PAGE_COLS', DEFAULTS.exportPdf.pageCols, 5, 100),
      pageRows: readInt('PDF_PAGE_ROWS', DEFAULTS.exportPdf.pageRows, 5, 100),
    },
    DEFAULTS.exportPdf,
  );
  return {
    generation: {
      defaultWidth: readInt('GEN_DEFAULT_WIDTH', DEFAULTS.generation.defaultWidth, LIMITS.targetWidth.min, LIMITS.targetWidth.max),
      defaultColorCount: readInt('GEN_DEFAULT_COLORS', DEFAULTS.generation.defaultColorCount, LIMITS.targetColorCount.min, LIMITS.targetColorCount.max),
    },
    exportPng: {
      cellPx: readInt('PNG_CELL_PX', DEFAULTS.exportPng.cellPx, 8, 48),
      cropToContent: readBool('PNG_CROP_TO_CONTENT', DEFAULTS.exportPng.cropToContent),
      includeLegend: readBool('PNG_INCLUDE_LEGEND', DEFAULTS.exportPng.includeLegend),
    },
    exportPdf,
    security: {
      loginRateLimit: readInt('RATE_LOGIN', DEFAULTS.security.loginRateLimit, 1),
      registerRateLimit: readInt('RATE_REGISTER', DEFAULTS.security.registerRateLimit, 1),
      tokenRateLimit: readInt('RATE_TOKEN', DEFAULTS.security.tokenRateLimit, 1),
      syncWriteRateLimit: readInt('RATE_SYNC_WRITE', DEFAULTS.security.syncWriteRateLimit, 1),
      backupAlertRateLimit: readInt('RATE_BACKUP_ALERT', DEFAULTS.security.backupAlertRateLimit, 1),
      analyticsRateLimit: readInt('RATE_ANALYTICS', DEFAULTS.security.analyticsRateLimit, 1),
      sessionTtlSeconds: readInt('SESSION_TTL_SECONDS', DEFAULTS.security.sessionTtlSeconds, 60),
      maxBodyBytes: readInt('MAX_BODY_BYTES', DEFAULTS.security.maxBodyBytes, 1024),
    },
    database: {
      poolMax: readInt('DB_POOL_MAX', DEFAULTS.database.poolMax, 1, 200),
      statementTimeoutMs: readInt('DB_STATEMENT_TIMEOUT_MS', DEFAULTS.database.statementTimeoutMs, 0, 600_000),
      connectionTimeoutMs: readInt('DB_CONNECTION_TIMEOUT_MS', DEFAULTS.database.connectionTimeoutMs, 0, 60_000),
      idleTimeoutMs: readInt('DB_IDLE_TIMEOUT_MS', DEFAULTS.database.idleTimeoutMs, 0, 600_000),
    },
  };
}

/** 模块级单例：服务端首次导入时固化（环境变量在进程启动时已定）。 */
export const config: SiteConfig = compute();

/**
 * 生产连接池选项（A-11）：无超时的池子在一条卡死语句下会耗尽 10 个连接，
 * 之后所有请求 hang 到 Node 超时 —— 表现为全站不可用而不是优雅 503。
 * 值为 0 时省略该项（交给 PostgreSQL 默认）。
 */
export function poolOptions(cfg: SiteConfig['database'] = config.database): {
  max: number;
  keepAlive: true;
  statement_timeout?: number;
  query_timeout?: number;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
} {
  return {
    max: cfg.poolMax,
    keepAlive: true,
    ...(cfg.statementTimeoutMs > 0
      ? { statement_timeout: cfg.statementTimeoutMs, query_timeout: cfg.statementTimeoutMs }
      : {}),
    ...(cfg.connectionTimeoutMs > 0 ? { connectionTimeoutMillis: cfg.connectionTimeoutMs } : {}),
    ...(cfg.idleTimeoutMs > 0 ? { idleTimeoutMillis: cfg.idleTimeoutMs } : {}),
  };
}

/** 浏览器端初始回退（SSR/未加载 /api/config 前使用）。 */
export const publicConfigFallback: PublicConfig = {
  generation: { ...DEFAULTS.generation },
  exportPng: { ...DEFAULTS.exportPng },
  exportPdf: { ...DEFAULTS.exportPdf },
};

/** /api/config 返回的公开子集（服务端运行时值）。 */
export function publicConfig(): PublicConfig {
  return {
    generation: { ...config.generation },
    exportPng: { ...config.exportPng },
    exportPdf: { ...config.exportPdf },
  };
}
