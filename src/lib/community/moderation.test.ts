import { describe, expect, it } from 'vitest';
import { moderateText, moderationRulesSchema } from './moderation';

describe('community moderation rules', () => {
  it('accepts only versionable literal category rules and rejects regex-shaped fields', () => {
    expect(moderationRulesSchema.safeParse([{ literal: '骚扰词', category: 'harassment', risk: 'review' }]).success).toBe(true);
    expect(moderationRulesSchema.safeParse([{ literal: '.*', category: 'spam', risk: 'review', regex: true }]).success).toBe(false);
    expect(moderationRulesSchema.safeParse([{ literal: '词', category: 'politics', risk: 'review' }]).success).toBe(false);
  });

  it('uses literal and structural rules without making URLs clickable or executing patterns', () => {
    expect(moderateText('这里含有骚扰词', [{ literal: '骚扰词', category: 'harassment', risk: 'review' }]))
      .toEqual({ needsReview: true, categories: ['harassment'] });
    expect(moderateText('https://a.example https://b.example', [])).toEqual({ needsReview: true, categories: ['spam'] });
    expect(moderateText('一条普通评论🙂', [])).toEqual({ needsReview: false, categories: [] });
  });
});
