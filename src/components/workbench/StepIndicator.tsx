'use client';

/**
 * 工作台三步指示器（D-2）。
 *
 * `workbench.stepUpload / stepCrop / stepWorkspace` 三条文案早就写好了，却从未
 * 渲染过：用户在「上传 → 裁剪 → 工作台」之间跳转时没有任何位置感，尤其是裁剪页
 * 看不出后面还有什么。这里只做位置提示，不承担导航（回退由「重新上传」负责），
 * 因此用 ol + aria-current 表达进度，而不是做成可点击的标签页。
 */
import { zhCN } from '@/messages/zh-CN';

export type WorkbenchStep = 'upload' | 'crop' | 'workspace';

const ORDER: WorkbenchStep[] = ['upload', 'crop', 'workspace'];

export default function StepIndicator({ step }: { step: WorkbenchStep }) {
  const t = zhCN.workbench;
  const labels: Record<WorkbenchStep, string> = {
    upload: t.stepUpload,
    crop: t.stepCrop,
    workspace: t.stepWorkspace,
  };
  const currentIndex = ORDER.indexOf(step);

  return (
    <nav aria-label={t.stepsAria} className="step-ticket-nav">
      <ol>
        {ORDER.map((item, index) => {
          const done = index < currentIndex;
          const current = index === currentIndex;
          return (
            <li key={item} data-state={current ? 'current' : done ? 'done' : 'pending'}>
              <span
                {...(current ? { 'aria-current': 'step' as const } : {})}
                className="step-ticket"
              >
                <span
                  aria-hidden="true"
                  className="step-ticket-number"
                >
                  {done ? '✓' : index + 1}
                </span>
                {labels[item]}
              </span>
              {index < ORDER.length - 1 && (
                <span aria-hidden="true" className="step-ticket-arrow">›</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
