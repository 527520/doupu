/**
 * 全项目共享的 zod 校验（spec §4.1、§5.3、§4.2；边界矩阵 E14/E15/E20/E31/E38）。
 * 客户端与服务端共用：API 输入、项目文件导入、自定义色板编辑。
 */
import { z } from 'zod';
import { LIMITS } from './appInfo';
import { BRANDS } from './types';

// ---------- 基础 ----------

/** 合法 hex 颜色：#RRGGBB（大小写均可）。 */
export const hexSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, '必须是 #RRGGBB 格式的颜色值');

/** 设计名称：1–100 字符，去除首尾空白后不得为空。 */
export const designNameSchema = z
  .string()
  .min(1, '名称不能为空')
  .max(LIMITS.designNameLength, `名称最长 ${LIMITS.designNameLength} 字符`)
  .transform((s) => s.trim())
  .refine((s) => s.length >= 1, '名称不能为空白字符');

/** 邮箱：合法格式、≤254 字符、统一小写。 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('邮箱格式不正确').max(254, '邮箱过长'));

/** 密码策略（ADR-0004）：8–72 字符，首尾不得为空白。 */
export const passwordSchema = z
  .string()
  .min(LIMITS.password.min, `密码至少 ${LIMITS.password.min} 个字符`)
  .max(LIMITS.password.max, `密码最长 ${LIMITS.password.max} 个字符`)
  .refine((s) => s === s.trim(), '密码首尾不能包含空格');

// ---------- 生成参数 ----------

export const generationParamsSchema = z.object({
  targetWidth: z
    .number()
    .int('必须是整数')
    .min(LIMITS.targetWidth.min)
    .max(LIMITS.targetWidth.max),
  targetColorCount: z
    .number()
    .int('必须是整数')
    .min(LIMITS.targetColorCount.min)
    .max(LIMITS.targetColorCount.max),
  dithering: z.boolean(),
  mode: z.enum(['dominant', 'average']),
  brightness: z.number().int().min(-100).max(100),
  contrast: z.number().int().min(-100).max(100),
  backgroundRemoval: z.boolean(),
  bgTolerance: z.number().int().min(0).max(40),
});

/** 解析生成参数；非法输入给出字段级错误。 */
export function parseGenerationParams(
  input: unknown,
): { ok: true; value: z.infer<typeof generationParamsSchema> } | { ok: false; errors: string[] } {
  const result = generationParamsSchema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, errors: zodErrorsToStrings(result.error) };
}

// ---------- 图纸 ----------

/** 单元格：透明格 hex/code 必须为 null；非透明格 hex 必填、code 可为 null 且 ≤20 字符。 */
export const patternCellSchema = z
  .object({
    hex: hexSchema.nullable(),
    code: z.string().max(20).nullable(),
    transparent: z.boolean(),
  })
  .superRefine((cell, ctx) => {
    if (cell.transparent) {
      if (cell.hex !== null || cell.code !== null) {
        ctx.addIssue({ code: 'custom', message: '透明格不应携带颜色' });
      }
    } else if (cell.hex === null) {
      ctx.addIssue({ code: 'custom', message: '非透明格必须携带 hex' });
    }
  });

export const patternSchema = z
  .object({
    width: z.number().int().min(1).max(LIMITS.targetWidth.max),
    height: z.number().int().min(1).max(LIMITS.targetWidth.max),
    cells: z.array(patternCellSchema),
  })
  .superRefine((pattern, ctx) => {
    if (pattern.cells.length !== pattern.width * pattern.height) {
      ctx.addIssue({
        code: 'custom',
        path: ['cells'],
        message: `单元格数量 ${pattern.cells.length} 与尺寸 ${pattern.width}×${pattern.height} 不符`,
      });
    }
  });

// ---------- 色板 ----------

export const customPaletteColorSchema = z.object({
  code: z
    .string()
    .min(1, '色号不能为空')
    .max(LIMITS.customPaletteCodeLength, `色号最长 ${LIMITS.customPaletteCodeLength} 字符`),
  hex: hexSchema,
});

export const customPaletteColorsSchema = z
  .array(customPaletteColorSchema)
  .min(1, '色板至少需要 1 个颜色')
  .max(LIMITS.customPaletteColors, `每块色板最多 ${LIMITS.customPaletteColors} 色`)
  .superRefine((colors, ctx) => {
    const codes = new Set<string>();
    const hexes = new Set<string>();
    colors.forEach((color, index) => {
      // 唯一性按「去首尾空白 + 大写」归一化比较；原始写法不受限制
      const normalizedCode = color.code.trim().toUpperCase();
      if (codes.has(normalizedCode)) {
        ctx.addIssue({ code: 'custom', path: [index, 'code'], message: `色号 ${color.code} 重复` });
      }
      codes.add(normalizedCode);
      const normalizedHex = color.hex.toUpperCase();
      if (hexes.has(normalizedHex)) {
        ctx.addIssue({ code: 'custom', path: [index, 'hex'], message: `颜色 ${color.hex} 重复` });
      }
      hexes.add(normalizedHex);
    });
  });

export const customPaletteSchema = z.object({
  id: z.string().optional(),
  name: designNameSchema,
  colors: customPaletteColorsSchema,
  updatedAt: z.string().datetime().optional(),
});

/** 项目文件色板引用。 */
export const projectPaletteSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin'), brand: z.enum(BRANDS) }),
  z.object({ kind: z.literal('custom'), colors: customPaletteColorsSchema }),
]);

// ---------- 项目文件（spec §5.3） ----------

export const projectFileSchema = z.object({
  format: z.literal('doupu-project'),
  version: z.literal(1),
  name: designNameSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  palette: projectPaletteSchema,
  params: generationParamsSchema,
  pattern: patternSchema,
});

export type ProjectFileParseResult =
  | { ok: true; value: z.infer<typeof projectFileSchema> }
  | { ok: false; errors: string[] };

/**
 * 严格解析项目文件（spec §5.3 导入规则）。
 * 先做体积检查（≤5 MB，E38），再做 schema 校验。
 */
export function parseProjectFile(input: string): ProjectFileParseResult {
  if (new TextEncoder().encode(input).length > LIMITS.projectFileBytes) {
    return { ok: false, errors: ['项目文件超过 5 MB 上限'] };
  }
  // 容忍 UTF-8 BOM（spec 边界 E11）
  const stripped = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  let json: unknown;
  try {
    json = JSON.parse(stripped);
  } catch {
    return { ok: false, errors: ['不是有效的 JSON 文件'] };
  }
  const result = projectFileSchema.safeParse(json);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, errors: zodErrorsToStrings(result.error) };
}

// ---------- API DTO ----------

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, '请输入密码').max(LIMITS.password.max),
});

export const verifyEmailSchema = z.object({ token: z.string().min(1) });
export const resendVerificationSchema = z.object({ email: emailSchema });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '请输入当前密码').max(LIMITS.password.max),
  newPassword: passwordSchema,
});
export const deleteAccountSchema = z.object({
  password: z.string().min(1, '请输入密码').max(LIMITS.password.max),
});

export const designPutSchema = z.object({
  name: designNameSchema,
  project: projectFileSchema,
});

export const palettePutSchema = z.object({
  name: designNameSchema,
  colors: customPaletteColorsSchema,
});

// ---------- 工具 ----------

/** 把 zod 错误扁平化为「路径: 原因」字符串数组。 */
export function zodErrorsToStrings(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(根)';
    return `${path}: ${issue.message}`;
  });
}
