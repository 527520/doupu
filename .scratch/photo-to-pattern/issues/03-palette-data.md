# 03: 色板数据模块

- Status: resolved

## 完成记录

- 数据复制：`src/lib/palettes/data/colorSystemMapping.json`（上游逐字副本，出处见 data/README.md 与 NOTICE.md）；`tests/fixtures/color-system-table.csv`（上游 `色号对应表.csv` 副本，实为 **UTF-8 带 BOM**，非此前记录的 GBK）。
- `src/lib/palettes/index.ts`：validateColorSystemData / normalizeCode（"-"→null）/ buildBrandPalette / getAvailableColors / lookupCode。
- 实测发现的上游数据事实：①漫漫品牌 S4 色号重复（#7FCD9D 与 #F3C1C0，CSV 亦同）——白名单锁定，不臆改数据；②CSV 个别单元格为多候选值（如盼盼 P05–P08 的 "157/70"）——按「JSON 取值 ∈ 候选集」比对；③#55514C 在漫漫下为 "-"（E19 依据）。
- 测试 10 例：完整性白名单断言、品牌 291 映射、normalizeCode、E19 可用色剔除、lookupCode、CSV 表头/行数/逐行一致性。
- Blocked by: 02

## 目标

内置五套国产色板数据的导入、完整性与可用性逻辑，以及自定义色板领域逻辑。

## 范围

- 从 `.scratch/photo-to-pattern/upstream/zippland/src/app/colorSystemMapping.json` 复制数据到 `src/lib/palettes/data/colorSystemMapping.json`，文件头注明出处（上游 AGPL-3.0）。
- `src/lib/palettes/`：加载与程序化校验（291 个 hex 合法且唯一；每品牌色号在品牌内唯一；"-" 值 → `code: null`）；`buildBrandPalette(brand)` → `PaletteColor[]`；可用色过滤（`code === null` 的 hex 在该品牌下不可用）；自定义色板领域逻辑（CRUD 校验、色号唯一、hex 合法唯一、≤500 色、≤20 字色号）。
- 交叉验证：解析上游根目录 `色号对应表.csv`（实际为 UTF-8 带 BOM 编码，非 GBK），断言其与 JSON 数据一致（CSV 多候选值如 `157/70` 按「JSON 取值 ∈ 候选集」比对）；上游已知缺陷（漫漫 S4 重复）白名单锁定。
- 最近色索引基础设施的输入类型（供 T05 使用）。

## 不含

- Oklab 距离与匹配（T05）；色板管理 UI（T18）；云端存储（T16）。

## 规格引用

- spec §F6、§3；边界 E19、E20。

## 验收标准

- [ ] 数据完整性断言全部通过（291/唯一/合法/品牌内唯一/null 处理）。
- [ ] CSV 交叉验证通过。
- [ ] 单测：品牌切换、含 null 色号的品牌可用色列表、自定义色板全部边界（E20）。
- [ ] 覆盖率 ≥90%。

## 完成记录

（resolve 时填写）
