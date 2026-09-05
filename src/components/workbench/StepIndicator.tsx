'use client';

/**
 * 选图后直接进入工作台；裁剪是工作台内的可选操作，不再暗示必经第三步。
 */
import { zhCN } from '@/messages/zh-CN';

export type WorkbenchStep = 'upload' | 'crop' | 'workspace';

const ORDER: WorkbenchStep[] = ['upload', 'workspace'];

export default function StepIndicator({ step }: { step: WorkbenchStep }) {
  const t = zhCN.workbench;
  const labels: Record<WorkbenchStep, string> = {
    upload: t.stepUpload,
    crop: t.stepCrop,
    workspace: t.stepWorkspace,
  };
  const currentIndex = ORDER.indexOf(step === 'crop' ? 'workspace' : step);

  return (
    <nav aria-label={t.stepsAria} className={step === 'upload' ? 'step-ticket-nav' : 'sr-only'}>
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
