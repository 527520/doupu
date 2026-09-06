# 10 文档、配置与发布准备

Status: ready-for-human
Completion: complete

## 交付

- CONTEXT.md：D49–D52、D13 标注取代、术语新增「作品原图」「审核判定记录」「作品标签」，「审核规则版本」标注退役，「官方批次」更正。
- ADR-0019（原图私有对象存储与权限代理）、ADR-0020（评论审核外部化与成本护栏）。
- `.env.example`、`docker-compose.prod.yml`、`src/lib/auth/runtimeConfig.ts`（生产必须有原图可写入的私有桶：默认沿用 `COS_BUCKET`，`COS_ORIGINALS_BUCKET` 可选分桶）、`deploy/CHECKLIST.md`（第 6 / 6b 步）。
- 迁移 0013–0015 及 down 脚本；`.gitignore` 增加 `.local-originals/`。

## 发布前人工事项

- 原图默认与备份共用现有私有桶（`originals/` 前缀），`.env` 不需新增 COS 变量；到控制台确认该桶没有会命中 `originals/` 的自动删除生命周期规则（备份改为人工定期清理）。
- 开通文本内容安全并记录策略编号；服务器 `.env` 补 `TMS_*`。未配置内容安全时评论全部待审，需要有人处理评论队列。
- 在具备 Playwright 浏览器的环境运行三浏览器 E2E；真机走查投稿原图步骤与引用后裁剪。
