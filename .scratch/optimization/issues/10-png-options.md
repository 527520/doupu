# 10 PNG 导出选项 UI

Status: ready-for-agent

## 目标

`png.ts` 已支持 cellPx(8-48)/cropToContent/includeLegend 但 UI 未暴露。要求：

1. 点击「导出 PNG」弹小面板（复用 Modal 或内联面板模式）：
   - 格子大小选择（小/中/大 ↔ 8/16/32，或直接数值选择）；
   - 「只导出图纸内容（裁掉边缘空白）」开关；
   - 「包含图例与色号清单」开关。
2. 默认值来自 config（票 02）：默认格子大小、默认开启图例。
3. 确认后导出，文件名规则不变；空图纸仍禁用导出。

## 边界

- 不改变现有默认导出行为（老用户无感），只是新增可选参数。
- 选项不影响 PDF 与项目文件导出。

## 验收

- 单测：面板渲染/开关状态/默认值；导出调用携带所选参数（mock）。
- E2E：改格子大小后下载的 PNG 尺寸变化（宽高比不变）；裁边开关生效（全透明图纸仍禁用）。
- 全量回归。

## 涉及文件

src/components/export/PngExportButton.tsx、src/lib/export/png.ts、src/lib/config.ts、src/messages/zh-CN.ts
