# 01 视觉升级：温柔治愈方向全站统一

Status: ready-for-agent

## 目标

按 /frontend-design 流程为豆谱做一次全站视觉升级（决策 D30：受众年轻女性、「温柔治愈」——奶油白底、低饱和粉紫点缀、圆润字体、柔和阴影；**不用**像素/豆粒/马赛克元素），重点：

1. 登录/注册/找回/重置/验证 5 个认证页重设计（现在太空）。
2. 首页（标题区/上传卡片/导航/页脚）按新设计语言重构。
3. 工作台、我的设计、色板管理、帮助、关于、404/错误页整体统一（间距/圆角/阴影/按钮/输入框/卡片）。
4. 手机端（≤640px）展示变形全面修复：表单宽度、长文案换行、弹窗、网格溢出、触控目标。

## 约束（不可破坏）

- 所有按钮/链接的**可访问名与文案不变**（E2E 依赖 getByRole）；只改样式与布局结构。
- 主操作色从 blue-600 演进到新色板主色时，全局 CSS 变量统一替换，不逐处硬编码。
- 移动端修复后跑窄屏 E2E（350px）回归。

## 验收

- 全量单测 + E2E 三浏览器全绿（认证旅程/工作台旅程/裁剪交互/同步/删除全部回归）。
- 5 个认证页、首页、工作台在 350px/1280px 视口人工走查无变形、无溢出。
- 设计提案（配色 token/字体/组件样式）先附在本票实现说明中。

## 涉及文件

src/app/globals.css、src/app/page.tsx、src/app/login|register|forgot-password|reset-password|verify-email/page.tsx、src/components/auth/*、src/components/layout/*、src/components/workbench/*、src/components/designs/*、src/components/palettes/*、src/app/not-found.tsx、src/app/error.tsx、src/app/help/about/page.tsx
