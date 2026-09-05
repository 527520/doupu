// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import HelpPage from './page';
import AboutPage from '../about/page';

describe('帮助页', () => {
  it('包含全部规定内容章节与 FAQ', () => {
    render(<HelpPage />);
    expect(screen.getByRole('heading', { name: '帮助' })).toBeTruthy();
    expect(screen.getByText('上传要求')).toBeTruthy();
    expect(screen.getByText('参数说明')).toBeTruthy();
    expect(screen.getByText('色板资料与制作规格')).toBeTruthy();
    expect(screen.getByText('板缝线')).toBeTruthy();
    expect(screen.getByText('导出说明')).toBeTruthy();
    expect(screen.getByText('常见问题')).toBeTruthy();
    expect(screen.getAllByText(/HEIC/).length).toBeGreaterThan(0);
    expect(screen.getByText(/透明底的像素画/)).toBeTruthy();
    expect(screen.getAllByText(/8000×8000/).length).toBeGreaterThan(0);
    expect(screen.getByText(/色号是拼豆品牌/)).toBeTruthy();
    expect(screen.getByText(/内置 13 套色板/)).toBeTruthy();
    expect(screen.getByText(/178dafb/)).toBeTruthy();
    expect(screen.getByText(/50 与 52 的 Mini 底板钉距不兼容/)).toBeTruthy();
    expect(screen.getByText('为什么“收录数”和“可生成数”不一样？')).toBeTruthy();
    expect(screen.getByText('项目文件会保存原图吗？')).toBeTruthy();
    expect(screen.getByText(/v3 项目文件只保存图纸、生成参数、制作规格、色板与套装档位/)).toBeTruthy();
    expect(screen.getByText('图纸宽度选多少合适？')).toBeTruthy();
    expect(screen.getByText(/熨烫时有什么技巧/)).toBeTruthy();
    expect(screen.getByText(/豆谱会收费吗/)).toBeTruthy();
  });
});

describe('关于页', () => {
  it('包含开源声明、源码链接与隐私政策', () => {
    render(<AboutPage />);
    expect(screen.getByRole('heading', { name: '关于豆谱' })).toBeTruthy();
    expect(screen.getByText(/AGPL-3.0/)).toBeTruthy();
    expect(screen.getByText(/Zippland\/perler-beads/)).toBeTruthy();
    expect(screen.getByText(/HansBug\/pindou-color-data/)).toBeTruthy();
    expect(screen.getByText(/178dafbc9e77d3de556550dbd058270200129186/)).toBeTruthy();
    expect(screen.getByText(/内置 13 套版本化色板/)).toBeTruthy();
    expect(screen.getByText(/2.6mm \/ 50×50、52×52/)).toBeTruthy();
    const sourceLink = screen.getByText('源码仓库');
    expect(sourceLink.getAttribute('href')).toBe('https://github.com/527520/doupu');
    expect(screen.getByRole('heading', { name: '隐私政策' })).toBeTruthy();
    expect(screen.getByText(/原图只在浏览器中处理，不上传服务器/)).toBeTruthy();
    expect(screen.getByText(/保留匿名化的公开作品、引用事实及必要治理记录/)).toBeTruthy();
  });

  it('包含作者信息（wuqian 与 GitHub 主页链接）', () => {
    render(<AboutPage />);
    expect(screen.getByRole('heading', { name: '作者' })).toBeTruthy();
    expect(screen.getByText(/wuqian/)).toBeTruthy();
    const githubLink = screen.getByRole('link', { name: 'GitHub 主页' });
    expect(githubLink.getAttribute('href')).toBe('https://github.com/527520');
    const mailLink = screen.getByRole('link', { name: 'wqa527520@qq.com' });
    expect(mailLink.getAttribute('href')).toBe('mailto:wqa527520@qq.com');
  });

  it('包含 GitHub Issues 反馈入口', () => {
    render(<AboutPage />);
    expect(screen.getByRole('heading', { name: '问题与建议' })).toBeTruthy();
    const issuesLink = screen.getByRole('link', { name: 'GitHub Issues 反馈' });
    expect(issuesLink.getAttribute('href')).toBe('https://github.com/527520/doupu/issues');
  });
});
