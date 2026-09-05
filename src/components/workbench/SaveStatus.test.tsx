// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SaveStatus, { LocalSaveBadge } from './SaveStatus';
import { zhCN } from '@/messages/zh-CN';

describe('SaveStatus', () => {
  it('尚未保存时不因登录就显示已保存', () => {
    render(<SaveStatus state="idle" cloudState="synced" loggedIn onSave={vi.fn()} />);
    expect(screen.getByText('尚未保存')).toBeVisible();
    expect(screen.queryByText(zhCN.workbench.localSavedBadge)).not.toBeInTheDocument();
    expect(screen.queryByText(zhCN.workbench.cloudSynced)).not.toBeInTheDocument();
  });
  it('新的本地修改不能沿用上一版已同步徽标', () => {
    render(<SaveStatus state="dirty" cloudState="synced" loggedIn onSave={vi.fn()} />);
    expect(screen.getByText(zhCN.workbench.cloudPending)).toBeVisible();
    expect(screen.queryByText(zhCN.workbench.cloudSynced)).not.toBeInTheDocument();
  });
  it.each(['quota', 'error', 'unavailable'] as const)('画布共用的 %s 状态不能伪装为已保存', (state) => {
    render(<LocalSaveBadge state={state} />);
    expect(screen.getByRole('status')).toHaveTextContent(zhCN.workbench.saveFailed);
    expect(screen.queryByText(zhCN.workbench.saved)).not.toBeInTheDocument();
  });
  it('登录后把本地保存与云端同步状态分开展示', () => {
    render(<SaveStatus state="saved" cloudState="synced" loggedIn onSave={vi.fn()} />);

    expect(screen.getByText(zhCN.workbench.saved)).toBeTruthy();
    expect(screen.getByText(zhCN.workbench.cloudSynced)).not.toHaveClass('hidden');
  });

  it('未登录时不显示误导性的云端状态', () => {
    render(<SaveStatus state="saved" cloudState="pending" loggedIn={false} onSave={vi.fn()} />);

    expect(screen.queryByText(zhCN.workbench.cloudPending)).toBeNull();
  });
});
