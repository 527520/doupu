# 05 官方批量：卡片布局、一键全选、原图随草稿上传

Status: ready-for-human
Completion: complete

## 交付

- `BatchSession`：新增 `uploading` / `upload_failed` 状态与 `hasOriginal`；草稿保存成功后上传原图，失败保留文件可重试；`selectAll` / `clearSelection` / `retryAllFailed` / `attachOriginal`（恢复的草稿缺原图时补选）。
- `OfficialBatchStudio` 改为卡片网格：缩略图与进度、状态徽标、标题、裁剪与参数、卡片底部动作；吸顶工具条含全选 / 取消全选 / 重试全部 / 发布已选；状态筛选芯片。
- 发布前服务端校验所有草稿都有原图（`ORIGINAL_REQUIRED`）。
- `listOfficialBatches` 的 `hasOriginal` 改为独立查询 `community_originals` 后取集合；E2E 发现原先内嵌 `sql\`exists (...)\`` 在 select 字段里恒为 false，恢复历史批次时所有草稿都被标成「原图未上传」。`db/officialBatch.test.ts` 已补断言。
- 禁用态的「选择图片文件」是 `<label>`，axe 不按原生禁用控件豁免：改背景色而不是把文字调灰，保证对比度。
