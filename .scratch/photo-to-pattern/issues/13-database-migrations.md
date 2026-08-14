# 13: 数据库 Schema 与迁移

- Status: resolved

## 父代理验证记录（阻塞已解除）

- 依赖已全部安装（drizzle-orm/pg/argon2/nodemailer + drizzle-kit/@electric-sql/pglite/@types/*）。
- **实现修正**：PGlite 不内置 citext 扩展 → schema 改为 `text` + `uniqueIndex('users_email_lower_unique').on(sql\`lower(email)\`)`（应用层 email 已由 zod 统一小写）；ADR-0003 同步更新。
- **迁移重建**：`drizzle-kit generate`（drizzle.config.ts 改为相对路径 `./db/schema.ts`）→ `db/migrations/0000_init.sql` + `meta/`（journal 去 BOM，tag=0000_init）；gen_random_uuid() 走 PG13+ 内置函数，无需 pgcrypto。
- **修复**：db/client.ts `rateLimits.window_start`→`windowStart`；drizzle 0.45 联合类型下 `.returning()` 需无参（全行返回）；vitest include 增加 `db/**/*.test.ts`。
- **验收**：`db/models.test.ts` 7/7 通过（PGlite 进程内，迁移幂等/大小写唯一/级联/限流/token 唯一/客户端 UUID 违约全部断言）；全量 289/289 绿、lint 绿、build 绿。

## 完成记录

**已交付**（全部完成，lint 全绿）：
- `db/migrations/0000_init.sql`：权威迁移（citext + pgcrypto 扩展；users/sessions/email_tokens/designs/palettes/rate_limits；级联外键；purpose CHECK；designs/palettes 为客户端 UUID 无默认值；users_email 独立唯一索引；designs(user_id,deleted_at,updated_at DESC) 同步索引等，与 schema.ts 逐一对应）。
- `db/schema.ts`：Drizzle 定义（citext customType、uniqueIndex、index().desc()、text enum），与迁移同名对齐，可安全用于 `drizzle-kit generate`。
- `db/client.ts`：`createProdClient(DATABASE_URL)`（node-postgres 连接池）+ `createTestClient()`（PGlite 内存库 + 执行 migrations 目录）+ `incrementRateLimit`（原子 upsert，窗口过期重置）。
- `db/models.test.ts`：7 组模型测试（迁移可重放幂等、citext 邮箱大小写唯一、级联删除四表、jsonb 深结构往返、限流原子递增/窗口重置、token_hash 唯一、客户端 id 无默认值违约）。
- `drizzle.config.ts`（刻意零依赖导入，形状兼容 drizzle-kit）、`.env.example`（仅 DATABASE_URL）、`docker-compose.dev.yml`（postgres:16 开发服务）。

**⛔ 阻塞（需父代理处理）**：`drizzle-orm`、`@electric-sql/pglite`、`pg`、`@types/pg`、`drizzle-kit` **均未安装**（任务说明中"pglite 已预装"不成立），且本代理被禁止 npm install / 修改 package.json。因此：
1. `npm run typecheck` 中 db/ 文件仅有"模块未找到"级联错误（无业务逻辑错误，lint 已全绿）；
2. `db/models.test.ts` 无法在本代理环境运行。

**父代理需执行**：
```powershell
$env:npm_config_cache = 'D:\project\perlerBeads\.npm-cache'
npm.cmd install --foreground-scripts --no-audit --no-fund drizzle-orm @electric-sql/pglite pg
npm.cmd install --foreground-scripts --no-audit --no-fund -D drizzle-kit @types/pg
npm.cmd run typecheck   # 应全绿（注意 src/components/export/PngExportButton.tsx 另有 zhCN.export 缺失问题，属其他票）
npm.cmd run test -- --run db/models.test.ts
```
**T21 待接 scripts**（本票不改 package.json）：`db:generate = drizzle-kit generate`、`db:migrate = drizzle-kit migrate`。

**另上报（非本票文件，未改动）**：`src/components/export/PngExportButton.tsx`（另一并行票的产出）引用了 `zhCN.export.*` 命名空间，但 `src/messages/zh-CN.ts` 尚无 `export:` 键 → 全局 typecheck 4 处报错，需由 messages 所有者或该票补上。
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
