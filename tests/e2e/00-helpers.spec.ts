import { expect, test } from '@playwright/test';
import { typeSpin } from './helpers';

test('typeSpin 在当前平台用标准快捷键替换数值而不是追加', async ({ page }) => {
  await page.setContent(`
    <button aria-label="Next.js Dev Tools"></button>
    <label for="width">目标宽度（格）</label>
    <input id="width" type="number" value="20" />
  `);

  await typeSpin(page, '目标宽度（格）', '200');

  await expect(page.getByRole('spinbutton', { name: '目标宽度（格）' })).toHaveValue('200');
});
