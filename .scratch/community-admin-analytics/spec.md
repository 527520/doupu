# 第一方匿名埋点、豆社与治理后台

Status: accepted

## Outcome

在现有 Next.js + PostgreSQL 单体中交付先同意后采集的第一方匿名分析、公开豆社、审核与人员治理后台，以及不上传原图的浏览器本地官方批量生产。分析或治理故障不得阻断上传、生成、编辑、保存和导出主流程。

## Invariants

- 未同意分析时不写访客 Cookie、不排队事件；拒绝或撤回后停止采集，撤回删除最近 90 天可关联原始事件和身份关联，去标识聚合保留。
- 原图、本地生成源、文件名、完整 IP、原始 User-Agent、搜索原文、评论正文和图纸正文不进入分析事件。
- 豆社只公开冻结的 `CommunitySnapshotV1`；内部 userId、私人 designId、邮箱与令牌不进入公开 DTO 或 HTML。
- 业务计数只来自业务表。分析事件与管理员审计分表，均不作为业务事实的来源。
- 账号暂停不改变内容状态；账号匿名化不可恢复，公开作品和去身份化治理记录保留。
- 普通用户不能创建正式标签或绕过审核。高风险评论进入待审，不自动删除或封号；不使用政治词库或管理员正则。
- 所有管理写入需要理由、期望版本和幂等键；人员高风险操作还需目标 userId 二次确认。
- `docs/marketing/` 是用户现有未跟踪内容，不修改、不提交。

## Capabilities

### Identity and governance

用户拥有 `user|moderator|admin` 角色和 `active|suspended|anonymized` 状态。共享 server-only DAL 在页面与 Route Handler 靠近数据处重新鉴权；角色/状态变化撤销会话，事务锁保证至少一名有效管理员。容器内 CLI 是唯一的首位管理员提权通道。追加式审计只保存白名单元数据。

### Analytics

客户端只有严格联合类型的 `track(event)`。同意偏好 Cookie 和 HttpOnly 匿名访客 Cookie 有 180 天有效期；数据库只存访客令牌哈希。批次最多 20 条/64 KiB，10 条或 10 秒发送，失败有界丢弃。精确明细、UV、组合筛选和 30 分钟同会话漏斗覆盖 90 天；91–730 天仅展示日总量和单维趋势。Asia/Shanghai 日维护以咨询锁、游标和运行日志保证可重入。

### Community

作品身份与不可变修订分离。修订为 `draft -> pending_review -> published|rejected|withdrawn`，被新版替换后为 `superseded`；作品为 `active|withdrawn|removed`。列表返回最多 48×48 派生预览，详情才返回完整快照。正式标签可排序、停用和合并；公开列表为 24 条游标分页。

引用只从当前可引用修订幂等创建独立私人设计。点赞、评论和举报使用事务计数与版本化去重。评论最多 500 字、纯文本、15 分钟内可编辑；高风险编辑回到待审。举报处置必须有理由。

### Administration and batches

`/admin` 是独立审核校样台。moderator 仅管理作品审核、标签、评论和举报；admin 另有分析、官方批次、人员、规则、完整审计与系统信息。批次最多 50 文件、单文件 20 MiB/64 MP、总计 200 MiB，最多两个可实例化 Worker；低并发设备降为一。成功项立即幂等保存为官方草稿并释放本地资源。

## Delivery

依次完成票 01–08。迁移保持 expand-only，并从当前 0004 带现存数据演练。每票通过针对性测试后本地原子提交；最终执行 lint、typecheck、单元/集成/覆盖率/性能/PostgreSQL 16/三浏览器 E2E/构建以及双轴 review。不 push、不 deploy、不访问生产。法律文案、真实备份、生产迁移、部署与真机验证是独立上线闸门。
