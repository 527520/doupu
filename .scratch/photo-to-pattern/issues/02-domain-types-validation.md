# 02: 领域核心类型与校验

- Status: open
- Blocked by: 无

## 目标

建立全项目共享的领域类型与 zod 校验（客户端与服务端唯一事实来源）。

## 范围

`src/lib/types.ts` + `src/lib/schemas.ts` + 测试：

- `Brand`、`PaletteColor {hex, code|null}`、`SampleMode`、`GenerationParams`、`PatternCell`、`Pattern`、`PatternStats`、`Design`（含元数据）、自定义色板类型。
- zod schema：参数边界（W 20–200、K 2–128、brightness/contrast -100–100、bgTolerance 0–40、mode 枚举）；hex `#RRGGBB`；项目文件 v1（spec §5.3 全字段）；API DTO（auth/designs/palettes，含 name ≤100、密码 8–72、色板 ≤500 色、色号 ≤20 字符）。
- 错误码枚举与 `AppError` 类型（供 UI 文案映射，见 E 系列用例）。
- 解析函数：`parseProjectFile`（严格模式，给出字段级错误）、`parseGenerationParams`。

## 不含

- 数据库映射（T13）、API 实现（T14/T16）、引擎算法（T05）。

## 规格引用

- spec §4.1、§5.3、§4.2（DTO）；边界 E14、E15、E31、E20（校验部分）。

## 验收标准

- [ ] 单测覆盖：参数全部边界（含 0/201/129/非整数拒绝）、hex 合法与非法样例、项目文件完整/缺字段/未知 version/未知 brand/超尺寸、密码 7/8/72/73 与首尾空白、色板 0/501 色/重复 hex/重复色号/超长色号。
- [ ] 错误信息包含字段路径，可映射 UI 文案。
- [ ] `src/lib` 覆盖率 ≥90%（本模块）。

## 完成记录

（resolve 时填写）
