// @vitest-environment jsdom
/**
 * 采购清单面板（F-3）：展开后能看到逐色包数，并能复制成可直接发送的文本。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ShoppingListPanel from './ShoppingListPanel';
import { zhCN } from '@/messages/zh-CN';
import type { PatternStatsItem } from '@/lib/types';

const stats: PatternStatsItem[] = [
  { code: 'A01', hex: '#FF0000', count: 1200 },
  { code: 'B02', hex: '#00FF00', count: 800 },
];

function setup() {
  return render(<ShoppingListPanel stats={stats} designName="小熊" width={50} height={40} />);
}

describe('ShoppingListPanel', () => {
  it('折叠时给出总量摘要，展开后列出逐色包数', () => {
    setup();
    expect(screen.getByText(zhCN.shopping.summary(2000, 2, 3, 1000))).toBeTruthy();
    expect(screen.queryByText('A01')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(zhCN.shopping.title) }));
    expect(screen.getByText('A01')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
    expect(screen.getByText(zhCN.shopping.packs(2))).toBeTruthy();
  });

  it('改每包颗数会重算包数', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(zhCN.shopping.title) }));
    fireEvent.change(screen.getByLabelText(zhCN.shopping.beadsPerPack), { target: { value: '500' } });
    // 1200 / 500 → 3 包，800 / 500 → 2 包
    expect(screen.getByText(zhCN.shopping.summary(2000, 2, 5, 500))).toBeTruthy();
  });

  it('复制清单写入剪贴板，内容含设计名与逐色行', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    setup();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(zhCN.shopping.title) }));
    fireEvent.click(screen.getByRole('button', { name: zhCN.shopping.copy }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('小熊（50 × 40 格）');
    expect(text).toContain('A01 ×1200（60%，2 包）');
    expect(await screen.findByText(zhCN.shopping.copied)).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('剪贴板不可用时明确提示手动复制，不假装成功', async () => {
    vi.stubGlobal('navigator', {});
    setup();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(zhCN.shopping.title) }));
    fireEvent.click(screen.getByRole('button', { name: zhCN.shopping.copy }));
    expect(await screen.findByText(zhCN.shopping.copyFailed)).toBeTruthy();
    expect(screen.queryByText(zhCN.shopping.copied)).toBeNull();
    vi.unstubAllGlobals();
  });

  it('空图纸不渲染（没有可买的东西就不占位置）', () => {
    const { container } = render(<ShoppingListPanel stats={[]} designName="空" width={1} height={1} />);
    expect(container.firstChild).toBeNull();
  });
});
