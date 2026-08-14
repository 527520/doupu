# 11: 项目文件导入/导出

- Status: open
- Blocked by: 02, 06

## 目标

项目文件（JSON v1）的序列化、严格校验、导出与导入 UX。

## 范围

- `serializeProject(design)` / `parseProjectFile(json)`（复用 T02 schema，严格模式）：format/version/name/palette/params/pattern 全量校验；version 不支持、brand 未知、cells 缺 hex 且非透明 → 明确错误。
- 导入规则：hex 为准、code 仅展示（跨品牌可用）；导入后作为新设计在工作台打开；文件名/名称冲突 → 自动加后缀或提示改名（选自动加后缀，测试锁定）。
- 导出：下载 `.json`（格式化缩进 2，`updatedAt` 置当前）。
- 导入大小限制：≤5 MB；损坏 JSON / 数组而非对象 / BOM 容忍（UTF-8 BOM 可解析）。

## 不含

- 云端同步格式转换（T16 复用同一 schema）。

## 规格引用

- spec §F7 项目文件、§5.3；边界 E25 相关、E38（5 MB）。

## 验收标准

- [ ] 单测：round-trip（导出→导入→逐字段相等）；坏文件矩阵（缺字段/超限 W=201/非法 hex/未知 brand/version=99/BOM/5MB+1B）；hex 为准的跨品牌导入。
- [ ] 组件测试：导入 UX（冲突自动后缀）、错误文案展示。
- [ ] 覆盖率 ≥90%。

## 完成记录

（resolve 时填写）
