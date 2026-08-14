# 13: 数据库 Schema 与迁移

- Status: open
- Blocked by: 02

## 目标

PostgreSQL schema（Drizzle）、迁移、连接池、测试库编排。

## 范围

- `db/schema.ts`（Drizzle）：users / sessions / email_tokens / designs / palettes / rate_limits，字段与索引按 spec §5.1、§5.2；`lower(email)` 唯一（citext）；级联删除。
- `db/migrations/`：SQL 迁移文件（`drizzle-kit generate` 产物提交）；迁移执行脚本（`db:migrate`）。
- 连接池模块（`pg` + drizzle node-postgres）；配置从环境变量读取（`.env.example` 增补 DB 相关项）。
- docker-compose：`postgres` 服务（开发/测试用；生产 compose 属 T21）；测试库隔离（每测试文件事务或独立 schema）。
- 模型单测：CRUD、唯一约束（重复 email 大小写变体）、外键级联删除、rate_limits 原子递增。

## 不含

- API 层（T14/T16）；生产部署编排（T21）。

## 规格引用

- spec §5.1、§5.2；ADR-0003。

## 验收标准

- [ ] 迁移从零可重放；`db:migrate` 幂等。
- [ ] 单测：唯一约束、级联删除、并发 upsert（updatedAt）行为符合预期。
- [ ] CI 用 docker-compose 测试库跑通（或 testcontainers）。

## 完成记录

（resolve 时填写）
