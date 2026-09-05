// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SharedPatternView from './SharedPatternView';
import { zhCN } from '@/messages/zh-CN';

const pattern = {
  width: 1,
  height: 1,
  cells: [{ hex: '#000000', code: 'H07', transparent: false }],
};
const stats = [{ hex: '#000000', code: 'H07', count: 1 }];

describe('SharedPatternView', () => {
  it('明确展示分享快照的制作规格与内置色板系列', () => {
    render(
      <SharedPatternView
        pattern={pattern}
        stats={stats}
        boardProfile="2.6mm-52"
        palette={{
          kind: 'builtin',
          brand: 'pcd:artkal-m-221-official@178dafbc9e77d3de556550dbd058270200129186',
        }}
      />,
    );

    const details = screen.getByRole('region', { name: zhCN.share.materialDetails });
    expect(details).toHaveTextContent('2.6mm / 52×52');
    expect(details).toHaveTextContent('优肯 Artkal M 221 色');
  });

  it('自定义色板只显示快照内的颜色数量', () => {
    render(
      <SharedPatternView
        pattern={pattern}
        stats={stats}
        boardProfile="5mm-29"
        palette={{ kind: 'custom', colors: [{ code: 'X1', hex: '#000000' }] }}
      />,
    );
    expect(screen.getByText(zhCN.share.customPalette(1))).toBeTruthy();
  });
});
