# 06 浏览器本地官方批量生产

Status: ready-for-human

Blocked by: 03

## Outcome

管理员可在浏览器本地批量生成官方草稿，逐项保存和重试，服务器永不接收原图、文件名或裁剪源。

## Tracer Bullet

三项队列以两个 Worker 运行，其中一项失败；成功两项各保存一次并释放资源，失败项可单独重试，刷新后只恢复服务器草稿。

## Acceptance Tests

- 50 文件/20 MiB/64 MP/200 MiB 上限与低并发降级。
- 暂停不派发、取消终止并标记、独立重试和幂等保存。
- File/ImageBitmap/Object URL/RGBA/Worker 缓存释放。
- 批量发布只处理再次勾选的合法草稿并写真实管理员审计。
