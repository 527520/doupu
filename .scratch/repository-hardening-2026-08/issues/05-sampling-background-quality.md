# 05 采样、透明边缘与背景质量

Status: ready-for-human

Blocked by: 04

## Outcome

照片 dominant 不再退化为左上首像素；不可整除区域不重复采样；透明边缘按 alpha 贡献；自动背景不误删贴边主体并允许手工取样。

## Tracer Bullet

用肤色渐变+透明抗锯齿+贴边主体三张最小 fixture 贯穿 quantized representative、coverage sampler、corner consensus 到最终 pattern。

## Implementation

- dominant 使用量化直方图，桶内选择感知代表色/medoid。
- 以连续像素覆盖面积分配权重，alpha 参与权重和输出。
- 背景 prototype 来自角落共识；洪泛比较固定 prototype 而非相邻链。
- 为用户提供手动背景取样和关闭自动背景的明确反馈。

## Acceptance Tests

- property：每个源像素对目标网格总覆盖权重守恒。
- 半透明颜色结果与 alpha-weight oracle 一致。
- 四边主体、渐变、阴影和合并前后背景均有 golden/误删断言。
- 新旧算法固定 fixture 人工并排验收。

## Files

`src/lib/engine/{sample,downscale,background,generate}.ts`、参数/UI、fixtures
