# 04 精确色彩匹配、合法色号与合并 oracle

Status: ready-for-human

Blocked by: 03

## Outcome

五套色板与自定义色板的真实色精确映射自身；引擎内部排除不可用颜色；合法格永不产生 `?`；合并算法返回满足上限的最小阈值。

## Tracer Bullet

先以漫漫 `#55514C` 和 MARD 291 色恒等测试复现，再用精确 Oklab 24-bit RGB cache 修复，最后用非单调四颜色 fixture 对穷举 oracle。

## Implementation

- 将 palette availability invariant 移入 generate module。
- 移除 15-bit 近似选择；以真实 RGB key 缓存精确 Oklab nearest result。
- 阈值范围有限穷举，明确 tie-break，不能二分假设单调。

## Acceptance Tests

- 五品牌所有可用颜色恒等；自定义 500 色恒等。
- 固定种子随机 RGB 与精确 oracle 选择完全一致。
- 随机小色板/频率属性测试与阈值穷举 oracle 一致。
- 200×200、291 色冷启动仍小于 2 秒。

## Files

`src/lib/engine/{generate,lut,merge}.ts` 及算法测试
