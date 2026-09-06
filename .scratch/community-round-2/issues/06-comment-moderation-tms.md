# 06 评论审核改腾讯云文本内容安全（D50 / ADR-0020）

Status: ready-for-human
Completion: complete

## 交付

- `src/lib/tencent/sign.ts` 通用 TC3 签名（SES 复用）；`src/lib/moderation/tencentTms.ts` `TextModeration` 适配器。
- `src/lib/moderation/commentModeration.ts` 管线：结构检查 → 限流（账号时/日、IP 时、突发、重复）→ 同文缓存 → 日预算 → 调用；失败一律待审；每步写 `comment_moderation_checks`。
- 迁移 `0015`：判定记录表 + 评论状态 `rejected`。
- `interactions.ts`：发表 / 编辑评论接入管线；拒绝 / 限流在事务提交后抛错以保留审计；治理队列附带判定摘要并包含 30 天内被拦截评论；`rejected` 只能复核后公开。
- 删除 `/admin/rules`、`RulesEditor`、`/api/admin/moderation-rules`、`moderation-rules:manage`；`moderation_rule_set_versions` 只读保留。
- 系统信息页新增「评论内容安全服务」区块；评论治理台显示判定来源 / 建议 / 类别 / 置信度 / 命中词。
- 集中配置：`TMS_*`、`RATE_COMMENT_*`。
- E2E 假服务放在 `src/lib/moderation/e2eFake.ts`，由 `DOUPU_E2E_SEED=1` 在 `interactions.ts` 内自行启用。教训：Next dev 里 instrumentation 与路由处理器各持一份模块实例，启动期通过 setter 注入的假服务对请求路径不可见（E2E 首轮 `E2E拦截词` 评论返回 201 而非 422）。
