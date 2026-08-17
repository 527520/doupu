# 10 安全图片入口、裁剪内存与资源释放

Status: ready-for-human

Blocked by: 03

## Outcome

超限图片在完整 RGBA 分配前被拒绝；裁剪页使用缩放预览；源图只向持久 Worker 传一次；HEIC 原生探针真实可解码；Bitmap 全路径释放；底边比例锁正确。

## Tracer Bullet

用高压缩超限 PNG 证明 natural-dimension preflight 在 canvas/getImageData 前拒绝，再用 8000×8000 合法 fixture 验证裁剪预览不复制全尺寸数据。

## Implementation

- 为 JPEG/PNG/WebP/HEIC 建立安全 dimension probe，解码前校验尺寸和面积。
- 裁剪组件只持有缩放 preview bitmap；确认裁剪时按区域生成工作分辨率。
- 源 RGBA ArrayBuffer 使用 transfer 一次交给 Worker session。
- 使用最小真实 HEIC fixture 探针；所有 success/error/context-null 都 close。
- 修复 lockRatio bottom handle 的水平居中与边界钳制。

## Acceptance Tests

- 超限压缩图在全尺寸 Canvas 前拒绝；三浏览器内存不越预算。
- 8000×8000 和 100×8000 合法输入不崩溃、无额外全尺寸 clone。
- Safari/WebKit 原生 HEIC 成功时不加载 WASM；每个 bitmap close 恰一次。
- bottom 1:1/2:1 及贴边 case 与几何 oracle 一致。

## Files

image decode/probe/validation、cropper/layout、generation transport、fixtures/tests
