# 18: 色板管理 UI

- Status: resolved
- Blocked by: 16

## 完成记录

- `src/components/palettes/api.ts`：listPalettes/savePalette/deletePalette（对接 T16 API，401/409/400 分类为 PalettesApiError）、`getPaletteColors(record)`（工作台接入接缝，T19）、newPaletteId。
- `src/components/palettes/PaletteEditor.tsx`：逐行录入（色号 ≤20/hex）+ 行内即时校验（E20 矩阵：非法 hex/重复色号大小写不敏感/重复 hex/超长色号/空板全局错误/500 上限）+ 粘贴导入（parseHexList 纯函数）+ 文件导入 + 复制自品牌（覆盖前确认，291 行含色号）+ 计数与保存禁用逻辑。
- `src/app/palettes/page.tsx`：内置五品牌只读展示（各 291 色）+ 自定义色板列表（空态/加载失败重试/未登录提示）+ 新建/编辑（含名称，重命名走编辑器）/删除（确认框）。
- `src/messages/zh-CN.ts` 定点新增 `palettes:` 命名空间（含 retry 键）。
- 测试 24 例：PaletteEditor 17（E20 矩阵全项 + 粘贴/文件/复制/纯函数）+ 页面 7（加载/空态/重试/401/新建保存/删除确认/编辑预填）。typecheck/lint 对本票文件零错误；`npm run test -- --run src/components/palettes src/app/palettes` 24/24 绿。
- 注：工作台品牌选择器接入自定义色板由 T19 用 getPaletteColors 接缝完成（按父代理指示不修改工作台）。

## 目标

/palettes 色板管理页，及工作台品牌选择器接入自定义色板。

## 范围

- /palettes：内置五套（只读展示）+ 自定义色板列表；新建/重命名/编辑/删除（二次确认）；色板编辑器：逐色录入（色号 ≤20 字、hex 合法、唯一性即时校验反馈）、导入 hex 列表（粘贴/文件）、复制自内置品牌；≤500 色计数显示。
- 校验反馈对照 E20 文案；错误就地提示（不合法的行标红）。
- 工作台高级面板品牌选择器：内置品牌 + 自定义色板分组；切换后重新生成（自定义色板为空时禁用选择并提示）。

## 不含

- 云端色板同步（T16 已含 API，本票只做 UI 接通）。

## 规格引用

- spec §F6；边界 E19、E20。

## 验收标准

- [ ] 组件测试：编辑校验反馈矩阵（非法 hex/重复色号/重复 hex/超长/501 色）。
- [ ] E2E：新建色板→选入工作台→生成图纸使用自定义色板色号。

## 完成记录

（resolve 时填写）
