# 16: 设计与色板 API + 同步引擎

- Status: resolved
- Blocked by: 13

## 父代理验证记录

- 集成修复：db/client 拆分（生产/测试分离）、`AnyDatabase` 联合类型、session.ts/rateLimit.ts 命名同步；T16 测试已自行切换到 `db/testClient.ts`。
- 验收：`src/lib/sync` 12/12、designs 路由 10/10、palettes 路由 5/5 全部通过；全量 376/376 绿、lint 绿、standalone 构建成功（提交 cd0fdd4）。

## 完成记录（实现完成；最终验收待父代理在 T14 落地后运行）

**交付文件**：
- `src/lib/sync/engine.ts`（纯同步引擎：SyncRecord/reconcile(LWW)/applyRemote/upsertLocal/markLocalDeleted/compareUpdatedAt，全确定性）+ `engine.test.ts`（**12/12 通过**，覆盖 E35 离线→上线幂等重放、E36 双设备 LWW、E37 云端删除 vs 本地离线编辑（双向）、墓碑忽略/推送、确定性排序、100 条规模）。
- `src/lib/sync/limits.ts`（exceedsProjectLimit 纯函数，Next 路由禁止额外导出故独立；单测锁定 5MB 行为）。
- `src/app/api/designs/route.ts`（GET 列表：非墓碑、updatedAt 降序、含 width/height）；`src/app/api/designs/[id]/route.ts`（GET 404 语义 / PUT 幂等 upsert（100 上限 409、5MB 400、坏字段 400、跨源 403、复活墓碑）/ DELETE 幂等 204）；palettes 同构（20/500 限额）。
- 路由测试 `designs.test.ts`（10 例）+ `palettes.test.ts`（5 例），PGlite + next/headers mock + createSession 真实会话。

**验证证据**：引擎 12/12 ✓；路由测试在 T14 改写 session.ts 之前整跑通过（25/27，2 个失败为本次测试自身缺陷，已修复：确定性期望、5MB 守卫不可达问题改为纯函数单测）。lint ✓。

**⛔ 外部阻塞（非本票代码）**：T14 代理并发改写 `db/client.ts`（导出改名 ProdDatabase/TestDatabase→db/testClient.ts）且其 `src/lib/auth/session.ts` 存在两处问题：① 第 51 行运行时 `ReferenceError: newExpiry is not defined`（声明行被注释吞掉）；② `import type Database from '@/../db/client'` 已无该导出（连同 rateLimit.ts）。本票路由测试因此无法端到端重跑，待 T14 修复后父代理运行 `npm run test -- --run src/app/api/designs src/app/api/palettes` 验证，并翻转 Status 为 resolved。

## 目标

designs/palettes API 与客户端同步引擎（本地 IndexedDB ↔ 云端，LWW）。

## 范围

- Route Handlers：GET/PUT/GET:id/DELETE /api/designs（墓碑、100 上限、5 MB 限制、name ≤100、客户端 UUID 幂等 upsert）；GET/PUT/DELETE /api/palettes（20 上限、≤500 色）。
- 同步引擎（`src/lib/sync/` 纯逻辑 + 适配器）：状态机（idle→diff→push→pull→conflict）；LWW 按 updatedAt；墓碑传播；离线队列（本地变更排队，上线重放）；幂等（重复 push 不产生重复）；「已在其他设备更新」提示条件。
- 客户端整合（浏览器侧）：登录后本地设计升级为云端设计；登出保留本地。
- 测试：引擎纯逻辑全边界 + route 测试（限额、越权、墓碑、并发 upsert）。

## 不含

- 列表/管理 UI（T17/T18）。

## 规格引用

- spec §F8、§4.2；边界 E35–E38。

## 验收标准

- [ ] 引擎单测：E35 离线→上线、E36 双设备 LWW、E37 云端删除 vs 本地离线编辑、E38 限额；幂等重放。
- [ ] route 测试：越权访问 404/403、超限 409、5 MB 校验、墓碑不可见但可恢复同步。
- [ ] 覆盖率 ≥90%。

## 完成记录

（resolve 时填写）
