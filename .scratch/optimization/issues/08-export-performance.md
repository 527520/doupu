# 08 导出性能：pdf-lib 按需加载 + PDF 字体子集

Status: ready-for-agent

## 目标

1. **pdf-lib/fontkit 按需加载**（盘点 #10）：`PdfExportButton` 静态 import 改为动态 `import()`（点击「导出 PDF」时才下载 412KB chunk）；生成中显示现有 busy 态。
2. **PDF 字体子集**（盘点 #11）：不再每次导出下载 16MB 全量 Noto OTF：
   - 生成一个子集字体文件（覆盖项目全部 UI 文案用字 + GB2312 常用字 + PDF 模板文字），提交到 public/fonts；
   - 子集缺字时兜底：保留全量字体路径（env 开关 `PDF_FONT_MODE=subset|full`，默认 subset）。

## 边界

- 子集生成脚本入库（`scripts/build-font-subset.mjs` 或同类），文档说明再生成流程；人工验证导出 PDF 的中文不缺字（页眉/图例/色号/提示）。
- E2E「导出 PDF 内容为 %PDF」用例继续通过；断言下载文件名不变。
- Next 构建产物中不再有首屏引用的 pdf-lib chunk。

## 验收

- 构建产物检查：工作台路由首屏 chunk 列表不含 pdf-lib（构建输出对比）。
- E2E 三浏览器导出 PDF 全绿；人工打开 PDF 检查中文渲染。
- 全量回归。

## 涉及文件

src/components/export/PdfExportButton.tsx、src/lib/export/pdf.ts、src/lib/export/pdfFont.ts、public/fonts/（子集文件）、scripts/build-font-subset.mjs（新）、.env.example
