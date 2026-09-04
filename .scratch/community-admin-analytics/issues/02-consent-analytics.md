# 02 同意式匿名分析与看板

Status: ready-for-agent

Blocked by: 01

## Outcome

只有明确同意的访客进入严格事件管道；90 天精确分析、两年聚合趋势、撤回删除和管理员看板可验证且不阻断业务。

## Tracer Bullet

未同意调用 `track` 不产生 Cookie/网络请求；同意后两个相同 eventId 只落一条，撤回后原始事件与身份关联被删除。

## Acceptance Tests

- Cookie、路径/referrer/UTM/UA 归一化、批量上限、事件判别联合和错误码白名单。
- 30 分钟同会话有序漏斗、90 天能力切换、禁止跨日 UV 相加。
- Asia/Shanghai 聚合、咨询锁重入、删除水位与维护失败隔离。
- 公开输出和事件表隐私扫描。
