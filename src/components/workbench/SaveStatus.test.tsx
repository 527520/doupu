// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SaveStatus from './SaveStatus';
import { zhCN } from '@/messages/zh-CN';

describe('SaveStatus', () => {
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
