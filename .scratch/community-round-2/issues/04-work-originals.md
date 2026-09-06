# 04 公开作品原图上传私有 COS 并交付引用者（D49 / ADR-0019）

Status: ready-for-human
Completion: complete

## 交付

- 迁移 `0014_community_originals`；`src/lib/cos/client.ts` COS v5 签名客户端；`originalStore.ts`（COS / 本机目录 / 内存三种实现，同一接口）。
- `src/lib/community/originals.ts`：上传校验与落库、权限判定（作者 / 审核员 / 引用者）、继承上一版原图、封禁 / 删除 / 清理 / 逾期删除。
- 服务层：提交审核与官方发布校验原图；撤回 / 驳回 / 替代 / 注销标记删除并在提交后清理；下架封禁、恢复解封；维护任务每日补扫。
- API：`PUT/GET/HEAD /api/community/revisions/[id]/original`（二进制上传走来源校验，类型按魔数嗅探）；引用接口返回 `originalAvailable`。
- 客户端：工作台保留会话原图副本 →「公开到豆社」经 IndexedDB 交接库带到投稿页；投稿页原图卡（预览、重新选择、正式同意条款、HEIC 转 JPEG、失败保留草稿可重试）；引用成功后拉取原图注入工作台（绑定不重生成）；工作台「从豆社取回原图」。
- 审核台与作品管理并排显示作者原图。
- 生产必须有可写原图的私有桶：默认沿用备份的 `COS_BUCKET`（`originals/` 前缀），`COS_ORIGINALS_*` 只用于单独分桶；开发 / E2E 落 `.local-originals/`。
- E2E 收尾修正：`pendingOriginals.ts` 全部访问经模块级串行队列并给 `indexedDB.open` 加 5s 超时（WebKit 并发 open + 首次建库会卡死，且不能拖住工作台恢复设计）；`CommunityInteractions.reuse` 先拉原图放交接库、失败才记来源，原图拉取 8s 超时；审核台 `.review-material-pair` 移动端用 `minmax(0,1fr)` 防 WebKit 溢出。
