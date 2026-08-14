# 16: 设计与色板 API + 同步引擎

- Status: open
- Blocked by: 13

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
