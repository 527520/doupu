// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AppPage from './page';

vi.mock('@/components/workbench/Workbench', () => ({
  default: () => <h1>工作台</h1>,
}));

describe('工作台页面语义', () => {
  it('页面只有一个 h1', () => {
    render(<AppPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
