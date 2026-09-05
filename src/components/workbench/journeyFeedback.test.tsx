// @vitest-environment jsdom
/**
 * 关键旅程的反馈与位置感（批次 D）：
 * D-1 生成完成必须有可感知反馈、D-2 两步主流程与可选裁剪、D-3 首页真落区交接。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StepIndicator from './StepIndicator';
import { zhCN } from '@/messages/zh-CN';
import { hasPendingUpload, setPendingUpload, takePendingUpload } from '@/lib/upload/pendingUpload';

describe('StepIndicator（D-2）', () => {
  it('裁剪属于图纸阶段；两步可见且当前步带 aria-current', () => {
    render(<StepIndicator step="crop" />);
    const list = screen.getByRole('navigation', { name: zhCN.workbench.stepsAria });
    expect(list).toBeTruthy();
    for (const label of [zhCN.workbench.stepUpload, zhCN.workbench.stepWorkspace]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByText(zhCN.workbench.stepCrop)).not.toBeInTheDocument();
    expect(screen.getByText(zhCN.workbench.stepWorkspace).closest('[aria-current="step"]')).toBeTruthy();
    expect(screen.getByText(zhCN.workbench.stepUpload).closest('[aria-current="step"]')).toBeNull();
  });

  it('步骤标签比页面标题短，避免与「裁剪图片」等标题混淆', () => {
    // 这是审查里踩过的坑：标签与页面标题同名会让「找到标题」的判断提前成立。
    expect(zhCN.workbench.stepCrop).not.toBe(zhCN.crop.title);
    expect(zhCN.workbench.stepUpload).not.toBe(zhCN.upload.title);
    for (const label of [zhCN.workbench.stepUpload, zhCN.workbench.stepCrop, zhCN.workbench.stepWorkspace]) {
      expect(label.length).toBeLessThanOrEqual(4);
    }
  });
});

describe('首页 → 工作台的图片交接（D-3）', () => {
  const file = { bytes: new Uint8Array([1]), name: 'a.png', type: 'png' as const };

  it('取用一次即清空，避免二次进入工作台时重复塞旧图', () => {
    expect(hasPendingUpload()).toBe(false);
    setPendingUpload(file);
    expect(hasPendingUpload()).toBe(true);
    expect(takePendingUpload()).toEqual(file);
    expect(hasPendingUpload()).toBe(false);
    expect(takePendingUpload()).toBeNull();
  });
});

describe('首页上传卡（D-3）', () => {
  it('是真的落区：拖入图片会交接文件并跳转工作台', async () => {
    const push = vi.fn();
    vi.doMock('next/navigation', () => ({ useRouter: () => ({ push }) }));
    const { default: HomeUploadCard } = await import('@/components/upload/HomeUploadCard');
    render(<HomeUploadCard />);

    // 1×1 PNG（validateImageFile 只看文件头与体积）
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00,
    ]);
    const dropped = new File([png], 'photo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(zhCN.upload.inputLabel), { target: { files: [dropped] } });

    await waitFor(() => expect(push).toHaveBeenCalledWith('/app?new=1'));
    expect(takePendingUpload()?.name).toBe('photo.png');
    vi.doUnmock('next/navigation');
  });

  it('三步引导文案真的渲染了（此前 home.guideStep* 从未出现在界面上）', async () => {
    vi.doMock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
    const { default: HomeUploadCard } = await import('@/components/upload/HomeUploadCard');
    render(<HomeUploadCard />);
    for (const step of [zhCN.home.guideStep1, zhCN.home.guideStep2, zhCN.home.guideStep3]) {
      expect(screen.getByText(step)).toBeTruthy();
    }
    vi.doUnmock('next/navigation');
  });
});
