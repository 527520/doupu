'use client';

/**
 * 首页上传卡（D-3）：真正的拖拽落区 + 拍照入口。
 *
 * 之前这里是个长得像落区的 `<Link>`，拖图进去没反应；文案还写着「支持拍照」
 * 却没有任何拍照入口。现在复用工作台的 UploadDropzone：拖拽、点击选择、
 * 文件级校验与错误提示都是同一套实现，校验通过后把文件交给工作台继续裁剪。
 */
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { UploadDropzone, type ValidImageFile } from '@/components/upload/UploadDropzone';
import { setPendingUpload } from '@/lib/upload/pendingUpload';
import { zhCN } from '@/messages/zh-CN';

export default function HomeUploadCard() {
  const router = useRouter();
  const [handing, setHanding] = useState(false);

  const onValid = useCallback((file: ValidImageFile): void => {
    setPendingUpload(file);
    setHanding(true);
    router.push('/app');
  }, [router]);

  return (
    <section className="flex w-full max-w-md flex-col gap-3 text-left">
      <UploadDropzone onValid={onValid} disabled={handing} capture />
      <ol className="flex flex-col gap-1 text-xs text-ink-soft sm:flex-row sm:justify-between sm:gap-2">
        {[zhCN.home.guideStep1, zhCN.home.guideStep2, zhCN.home.guideStep3].map((step, index) => (
          <li key={step} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary-deep"
            >
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}
