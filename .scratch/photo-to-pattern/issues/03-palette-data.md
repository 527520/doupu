# 03: 色板数据模块

- Status: open
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
