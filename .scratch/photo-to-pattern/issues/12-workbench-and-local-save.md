# 12: 工作台组装与本地保存

- Status: resolved
- Blocked by: 07, 08, 09, 10, 11

## 目标

`/app` 工作台把「上传→裁剪→参数→生成→编辑→导出」串成完整流程，并提供未登录可用的本地保存。

## 范围

- `/app` 页面：步骤状态机（上传→裁剪→工作台）；工作台左图（预览/编辑器切换）右参数/工具；顶部：设计名（可重命名）、品牌显示、保存状态、导出菜单（PNG/PDF/项目文件）。
- `src/lib/storage/`：IndexedDB 仓库（designs 表：id/name/project/thumbnail/updatedAt；元数据表：本地会话状态）；本地库不设上限；写入失败（配额满）提示并建议导出项目文件；缩略图生成（≤256px 数据 URL）。
- 未登录可用；登录后本地设计进入同步域（接口与 T16 衔接，本票先以接口契约 stub + 本地实现）。
- 页面卸载前防丢失：草稿自动保存（防抖 1 s）到本地；`beforeunload` 提示未保存变更。

## 不含

- 云端同步引擎（T16）；设计列表页（T17）。

## 规格引用

- spec §F8（本地部分）、§F11；边界 E39。

## 验收标准

- [x] 组件/单测：storage 层 CRUD、配额失败降级路径、自动保存与防丢失。
- [ ] 全流程可离线完成（Playwright：断网下 生成→编辑→导出 成功）→ 留 T20 E2E。
- [x] 刷新后从本地恢复最后设计（单测覆盖 restore；浏览器级验证留 T20 E2E）。

## 完成记录

- `src/app/app/page.tsx`：工作台页（客户端组装）。
- `src/lib/storage/index.ts`：IndexedDB 薄适配层（designs/meta 两表、getAll 按 updatedAt 降序、QuotaExceededError 类型化）+ 纯函数（buildThumbnailSize ≤256px、renderThumbnail 失败回退 null、nextDesignName 复用冲突命名、parseStoredProject、createDesignRecord、newDesignId、isQuotaError）。
- `src/components/workbench/`：Workbench（上传→裁剪→工作台步骤状态机；decode→validatePixelCount→cropImageData→generatePattern 管线；参数/品牌切换重生成；预览/编辑双页签；PNG/PDF/项目文件三导出接线；导入项目文件含自定义色板）；DesignNameEditor；SaveStatus（saving/saved/quota/error/unavailable + 手动保存）。
- 本地保存：自动保存 1s 防抖（dirty 标记）+ 手动保存；beforeunload 防丢失；启动恢复最后设计；配额满显示导出项目文件建议（E39）；未登录本地保存提示与 onSavedStatus 接缝（T17）。
- 测试：storage 层 9 例（内存 FakeStorage：CRUD/upsert/排序/配额/纯函数）+ Workbench 8 例（全流程含参数面板改宽度重生成、解码失败、恢复、防抖自动保存、手动保存、配额提示、不可用提示、编辑触发保存）。
- 测试修复记录（评审后）：①fake timers 不得早于 restore 等待启用（testing-library 轮询被假计时器卡死→级联超时），重构为「真实计时器完成恢复 → 再开假计时器推进防抖」；②全流程用例改为先断言默认 100×100=10000 粒、再经参数面板设宽度 20 重生成断言 400 粒；③tests/setup.ts 补 toDataURL 桩消除 jsdom 噪声。
- 验证结果：`npm run test -- --run src/components/workbench/Workbench.test.tsx` 8/8 通过；全量 324/325（唯一失败为 src/lib/export/pdf.cjk.test.ts 的断言 bug：期望 'Helvetica' 实得 '/Helvetica'，属 T10 文件，未越权修改，已上报）。
- 类型/lint 全绿。
- **所有权偏离披露**：为让工作台取得编辑后的图纸，对 `src/components/editor/PixelEditorCanvas.tsx` 做了一处最小加法修改（新增可选 `onPatternChange` 回调，向后兼容，仅在 commit/undo/redo 时发出副本）；无该接缝则保存/导出无法包含编辑结果。
