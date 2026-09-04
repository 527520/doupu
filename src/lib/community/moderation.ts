import { z } from 'zod';

export const MODERATION_CATEGORIES = ['harm', 'harassment', 'sexual', 'spam'] as const;
export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

export const moderationRuleSchema = z.object({
  literal: z.string().trim().min(1).max(80),
  category: z.enum(MODERATION_CATEGORIES),
  risk: z.enum(['review']),
}).strict();

export const moderationRulesSchema = z.array(moderationRuleSchema).min(1).max(500).superRefine((rules, ctx) => {
  const seen = new Set<string>();
  rules.forEach((rule, index) => {
    const key = `${rule.category}:${rule.literal.toLocaleLowerCase('zh-CN')}`;
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [index, 'literal'], message: '同分类字面词重复' });
    seen.add(key);
  });
});

export type ModerationRule = z.infer<typeof moderationRuleSchema>;

export const INITIAL_MODERATION_RULES: readonly ModerationRule[] = [
  { literal: '杀了你', category: 'harm', risk: 'review' },
  { literal: '去死', category: 'harm', risk: 'review' },
  { literal: '废物', category: 'harassment', risk: 'review' },
  { literal: '滚出去', category: 'harassment', risk: 'review' },
  { literal: '成人视频', category: 'sexual', risk: 'review' },
  { literal: '色情交易', category: 'sexual', risk: 'review' },
  { literal: '加微信', category: 'spam', risk: 'review' },
  { literal: '代刷', category: 'spam', risk: 'review' },
];

export interface ModerationResult {
  needsReview: boolean;
  categories: ModerationCategory[];
}

export function moderateText(text: string, rules: readonly ModerationRule[]): ModerationResult {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('zh-CN');
  const categories = new Set<ModerationCategory>();
  for (const rule of rules) {
    if (normalized.includes(rule.literal.normalize('NFKC').toLocaleLowerCase('zh-CN'))) {
      categories.add(rule.category);
    }
  }
  const urlCount = normalized.match(/(?:https?:\/\/|www\.)/gu)?.length ?? 0;
  if (urlCount > 1) categories.add('spam');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) categories.add('spam');
  if (/(.)\1{9,}/u.test(normalized)) categories.add('spam');
  return { needsReview: categories.size > 0, categories: [...categories].sort() };
}
