# 05: 生成引擎（量化管线）

- Status: resolved

## 完成记录

- `src/lib/engine/`：color.ts（Oklab 移植上游常量 + 预计算平方距离）、brightness.ts、downscale.ts（盒式降采样，每格最多 8×8 源像素，性能关键）、lut.ts（15-bit LUT + 色板级缓存 + clearLutCache）、dither.ts（蛇形 FS 扩散、透明跳过、Float64 累加）、sample.ts（主色平票取先出现/平均色/透明）、merge.ts（频率降序 + 二分最小 θ∈[0,60]）、background.ts（边界洪泛 + 缓存）、generate.ts（管线编排 + computeStats）。
- 测试 42 例：E14–E19 全部、50 组属性测试（尺寸/色板内/统计自洽）、确定性 deep-equal、性能 200×200 = 756ms（预算 2s）、误差守恒、不可整除格边界、1×1→200×200 不除零、θ=60 不可达分支。
- 过程中修复：LUT 未缓存导致每次生成 ~1.5s（现缓存+Oklab 预计算）；测试设计两处修正（Oklab 纯黑附近灰阶距离拉伸、merge 存活格 code 语义）。
- Blocked by: 02, 03

## 目标

实现确定性生成管线：预处理 → 抖动 → 格采样 → Oklab 匹配 → 频率合并 → 背景去除 → 统计。

## 范围

`src/lib/engine/`（纯函数，无 DOM）：

- `applyBrightnessContrast(rgb, b, c)`（spec §F4 公式，clamp 0–255）。
- `buildLut(palette, distance)`：15-bit RGB LUT（32768 项），每换色板重建。
- `floydSteinberg(imageData, palette, lut)`：蛇形扫描，误差扩散 7/16、3/16、5/16、1/16，透明像素跳过。
- `sampleCells(imageData, W, M, mode)`：主色（频率最高，平票取先出现者）/平均色；alpha<128 忽略；全透明格 → transparent。
- `oklabDistance`（上游公式 ×100）、`findClosestAvailable`（过滤不可用色；palette 为空/全不可用时的定义行为：报错）。
- `mergeByTargetCount(cells, palette, K)`：频率降序 + 二分最小 θ∈[0,60]（Oklab 距离 <θ 合并低频入高频）；K≥初始 distinct 不合并；确定性。
- `removeBackground(cells, τ)`：边界洪泛，与当前色距离 <τ 连通标记外部（spec §F4.6）。
- `generatePattern(imageData, params, palette)` 编排 + `computeStats`（用量降序）。
- 性能预算：200×200 ≤2 s（基准测试用例）。

## 不含

- UI（T06）；编辑器（T08）。

## 规格引用

- spec §F4 全文；边界 E14–E19。

## 验收标准

- [ ] 单测：E14（W 边界）、E15（K 边界与不合并）、E16（抖动+全透明无 NaN）、E17（极端亮度对比度）、E18（全图同色背景去除）、E19（含 null 色号品牌改配最近可用色）。
- [ ] 属性测试：随机输入（含极端）不抛异常、输出 hex 均在可用色板内或透明、尺寸恒为 W×M。
- [ ] 确定性：同输入两次输出完全一致。
- [ ] 性能测试：200×200 在 CI 机器 ≤2 s（含 LUT 重建）。
- [ ] 覆盖率 ≥90%。

## 完成记录

（resolve 时填写）
