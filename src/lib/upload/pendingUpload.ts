/**
 * 首页 → 工作台 的待处理图片交接（D-3）。
 *
 * 首页那个虚线框此前是个 `<Link>`：长得像可拖拽落区，拖图进去却毫无反应，
 * 是审查里最典型的「界面在撒谎」。要让首页真的能落图，就得把校验通过的文件
 * 带过一次路由跳转 —— File 无法放进 URL，但 App Router 的站内跳转是客户端
 * 导航，模块级单例在这次跳转中是存活的，所以用一个一次性取用的模块变量交接。
 *
 * 约定：set 之后必须紧跟 router.push；take 一次即清空，避免用户回到首页
 * 再进工作台时又把旧图片塞进去。
 */
import type { ValidImageFile } from '@/components/upload/UploadDropzone';

let pending: ValidImageFile | null = null;

export function setPendingUpload(file: ValidImageFile): void {
  pending = file;
}

/** 取出并清空（只会被消费一次）。 */
export function takePendingUpload(): ValidImageFile | null {
  const current = pending;
  pending = null;
  return current;
}

export function hasPendingUpload(): boolean {
  return pending !== null;
}
