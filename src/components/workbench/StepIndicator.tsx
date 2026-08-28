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
    <nav aria-label={t.stepsAria}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm">
        {ORDER.map((item, index) => {
          const done = index < currentIndex;
          const current = index === currentIndex;
          return (
            <li key={item} className="flex items-center gap-2">
              <span
                {...(current ? { 'aria-current': 'step' as const } : {})}
                className={[
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors',
                  current ? 'bg-primary-soft font-medium text-primary-deep' : '',
                  done ? 'text-ink-soft' : '',
                  !current && !done ? 'text-ink-soft/60' : '',
                ].filter(Boolean).join(' ')}
              >
                <span
                  aria-hidden="true"
                  className={[
                    'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold',
                    current ? 'bg-primary text-white' : '',
                    done ? 'bg-success-soft text-success' : '',
                    !current && !done ? 'border border-lilac/60 text-ink-soft/60' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {done ? '✓' : index + 1}
                </span>
                {labels[item]}
              </span>
              {index < ORDER.length - 1 && (
                <span aria-hidden="true" className="text-ink-soft/40">›</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
