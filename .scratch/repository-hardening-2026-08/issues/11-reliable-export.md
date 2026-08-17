# 11 可靠 PNG/PDF 极限导出

Status: ready-for-human

Blocked by: 04, 07

## Outcome

500 色 PDF 图例完整分页；配置按整体页面几何校验；PNG 图例可换行并在编码前检查 Canvas 极限；200×1 合法项目三浏览器可导出。

## Tracer Bullet

生成 500 色、200×1、长中文色号项目，同时导出 PDF/PNG；解析 PDF 坐标和解码 PNG 像素，而不是只检查字节大小。

## Implementation

- PDF legend 按可用高度分页；每条 code 坐标必须位于 media box。
- config 以纸张尺寸、margin、cell、rows/cols 的组合约束验证或派生。
- PNG legend 按最大宽度多行/下置布局；计算 Canvas 宽高/面积后再创建。
- 抽出纯 draw commands 供精确 mock；浏览器产物做像素/golden。

## Acceptance Tests

- 500 个唯一色号全部在 PDF 可见页面；组合非法配置在启动/解析时明确失败。
- 200×1、200 色、长色号、48px 在 Chromium/Firefox/WebKit 成功。
- grid、code、seam、crop、legend 的关键像素与 golden 一致。

## Files

`src/lib/export/{png,pdf,pdfLayout}.ts`、config、canvas test adapter、E2E
