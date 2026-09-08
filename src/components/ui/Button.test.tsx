// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Button, { ButtonLink, buttonClassName } from './Button';
import IconButton from './IconButton';

afterEach(() => cleanup());

describe('Button', () => {
  it('按语气与尺寸拼出全站共用的类名', () => {
    expect(buttonClassName('primary')).toBe('btn-primary');
    expect(buttonClassName('quiet', 'sm', 'extra')).toBe('btn-quiet btn-sm extra');
    expect(buttonClassName('danger', 'xs')).toBe('btn-danger-outline btn-xs');
    expect(buttonClassName('dangerSolid')).toBe('btn-danger');
  });

  it('默认 type=button，带图标时图标不进入可访问名称', () => {
    render(<Button icon="trash" variant="danger">删除</Button>);
    const button = screen.getByRole('button', { name: '删除' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(button.className).toBe('btn-danger-outline');
  });

  it('loading 时禁用并标注 aria-busy，不触发点击', async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>保存中</Button>);
    const button = screen.getByRole('button', { name: '保存中' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading 时用加载环占据图标位，且加载环不进入可访问名称', () => {
    const { rerender } = render(<Button loading icon="send">发布中</Button>);
    const button = screen.getByRole('button', { name: '发布中' });
    expect(button.querySelector('.spinner')).toHaveAttribute('aria-hidden', 'true');
    expect(button.querySelector('svg')).toBeNull();
    rerender(<Button icon="send">发布</Button>);
    expect(screen.getByRole('button', { name: '发布' }).querySelector('.spinner')).toBeNull();
  });

  it('ButtonLink 渲染为链接并沿用按钮类名', () => {
    render(<ButtonLink href="/community" variant="primary" icon="arrow" iconPosition="end">打开豆社</ButtonLink>);
    const link = screen.getByRole('link', { name: '打开豆社' });
    expect(link).toHaveAttribute('href', '/community');
    expect(link.className).toBe('btn-primary');
  });
});

describe('IconButton', () => {
  it('必须有可访问名称，并把 pressed 映射到 aria-pressed', async () => {
    const onClick = vi.fn();
    render(<IconButton icon="heart" label="点赞" pressed={false} onClick={onClick} />);
    const button = screen.getByRole('button', { name: '点赞' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('title', '点赞');
    expect(button.className).toContain('btn-bead');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('语气写入 data-tone，neutral 不写属性', () => {
    const { rerender } = render(<IconButton icon="trash" label="删除" tone="danger" />);
    expect(screen.getByRole('button', { name: '删除' })).toHaveAttribute('data-tone', 'danger');
    rerender(<IconButton icon="trash" label="删除" />);
    expect(screen.getByRole('button', { name: '删除' })).not.toHaveAttribute('data-tone');
  });
});
