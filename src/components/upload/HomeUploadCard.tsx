'use client';

/**
 * 首页上传卡（D-3）：真正的拖拽落区 + 拍照入口。
 *
 * 之前这里是个长得像落区的 `<Link>`，拖图进去没反应；文案还写着「支持拍照」
 * 却没有任何拍照入口。现在复用工作台的 UploadDropzone：拖拽、点击选择、
 * 文件级校验与错误提示都是同一套实现，校验通过后交给工作台自动生成整图预览。
 */
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { UploadDropzone, type ValidImageFile } from '@/components/upload/UploadDropzone';
import Icon from '@/components/ui/Icon';
import { setPendingUpload } from '@/lib/upload/pendingUpload';
import { zhCN } from '@/messages/zh-CN';

export default function HomeUploadCard() {
  const router = useRouter();
  const [handing, setHanding] = useState(false);

  const onValid = useCallback((file: ValidImageFile): void => {
    setPendingUpload(file);
    setHanding(true);
    // ?new=1：与「新建设计」同一语义——跳过历史设计恢复，避免上一张设计
    // 的恢复流程在竞态里把即将生成预览的新图顶掉（回到旧设计）。
    router.push('/app?new=1');
  }, [router]);

  return (
    <section className="studio-panel home-start-card">
      <header className="home-start-heading">
        <span><Icon name="upload" size={25} /></span>
        <div><h2>{zhCN.home.fromImage}</h2><p>{zhCN.home.fromImageHint}</p></div>
      </header>
      {/* 不加 capture：移动端带 capture 只能开摄像头、选不了相册（真机验收回归）。 */}
      <UploadDropzone onValid={onValid} disabled={handing} />
      <Link href="/app?new=1#blank-start" className="home-blank-action">
        <Icon name="blank" />
        <span><strong>{zhCN.home.blankStart}</strong><small>{zhCN.home.blankHint}</small></span>
        <Icon name="arrow" size={17} />
      </Link>
    </section>
  );
}
