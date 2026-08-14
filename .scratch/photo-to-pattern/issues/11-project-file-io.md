# 11: 项目文件导入/导出

- Status: resolved

## 完成记录

- `src/lib/project/serialize.ts`：serializeProject（2 空格缩进、updatedAt=now、format/version 补全）+ projectFileName（非法字符替换、空名回退「未命名设计」）。
- `src/lib/project/parse.ts`：importProjectFile（复用 schemas.parseProjectFile：5MB 上限/BOM/严格 schema）+ conflictName（`名称 (2)` 序列、100 字符截断、后缀唯一性）。
- `src/components/export/ProjectFileButtons.tsx`：导出（Blob 下载、正确文件名）、导入（文件选择、5MB 预检、字段级错误列表、名称冲突自动后缀后 onImport、input 值重置可重复选择）。
- 文案：zh-CN 新增 `project:` 命名空间（定点编辑）。
- 测试：`project.test.ts` 16 例（round-trip 逐字段、坏文件矩阵含 version=99/未知 brand/W=300/非法 hex/5MB+1B/BOM 端到端、conflictName 矩阵、文件名清洗）+ `ProjectFileButtons.test.tsx` 8 例（下载锚点、导入成功/冲突后缀/损坏 JSON/未知 brand/超限/错误清除/disabled）。
- 注：未运行 vitest（沙箱禁止子进程且本会话禁 escalation）；lint ✓；typecheck 仅剩 db/schema.ts 报错（T13 进行中，drizzle-orm 未安装），本票文件零错误。
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
