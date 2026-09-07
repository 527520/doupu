# 08 官方批量重做

Status: ready-for-agent
Completion: not-started

## 目标

官方批量改为分步流程，缩略图改服务端带格线 PNG，允许选择制作规格与色板/套装档位。

## 范围

- `OfficialBatchStudio` 重构为四步：
  1. 选图：钉板落区（多选）+「恢复已保存批次」列表；制作规格（`ResponsiveSelect`）与色板/套装档位（复用 `PalettePicker` 简化版）；
  2. 参数与裁剪：统一参数（`NumberField`/`Switch`/`SegmentedControl`）、理由；卡片列表逐张标题、裁剪、覆盖参数（`Disclosure`）；
  3. 生成：进度、暂停/继续/取消/重试；
  4. 核对与发布：卡片用 `CommunityThumbnail`（`revisionId`），原图状态徽标，全选/清除，发布确认弹窗。
- `batchSession.ts`：`defaults` 扩展 `boardProfile` 与 `paletteSelection`；`batchGeneration.ts` 按选择生成；服务端 `createOfficialBatch` 的 `defaultParams` schema 与 `saveOfficialDraft` 快照校验接受并校验二者。
- 页头去重（`admin-page-header` 与组件内 header 只留一个）。
- 同步 `tests/e2e/15-official-batch-recovery.spec.ts` 与 `OfficialBatchStudio.test.tsx` 的选择器/文案。

## 验收

- E2E `15` 四个用例通过；单测 `batchSession`/`OfficialBatchStudio` 通过；恢复历史批次时卡片显示带格线缩略图。
