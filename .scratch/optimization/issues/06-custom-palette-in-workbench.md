# 06 工作台接入云端自定义色板

Status: ready-for-agent

## 目标（spec F3 断链）

用户建的自定义色板目前在工作台选不到。要求：

1. 登录用户进入工作台时加载 `/api/palettes`（GET，已按用户过滤），把自定义色板合并进「色板品牌」下拉（分组：内置品牌 / 我的色板）。
2. 选中自定义色板 → 生成管线使用其颜色集合（复用现有 customPalette 状态路径）。
3. 未登录：下拉不显示自定义组（或显示「登录后可用」提示，点击去登录）。
4. 自定义色板删除/改名后，工作台下拉刷新（每次打开工作台/切回时重新拉取；失败静默回退内置色板并保留上一次选择）。
5. 空色板（0 色）不可选；加载中显示占位。

## 边界

- 不改变「导入项目文件自带自定义色板」的既有行为。
- 生成统计/导出与自定义色板组合的既有路径已存在，只补选择入口。

## 验收

- 单测：Workbench 下拉渲染自定义组（mock api）、选中后 regenerate 使用自定义色板。
- E2E：注册→建自定义色板→工作台下拉选中→生成成功（三浏览器）。
- 全量回归。

## 涉及文件

src/components/workbench/Workbench.tsx、src/components/params/GenerationParamsPanel.tsx、src/lib/sync/api.ts、src/messages/zh-CN.ts
