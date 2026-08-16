# 01 视觉升级：温柔治愈方向全站统一

Status: done

## 设计提案（用户已批准，2026-02）

- **配色 token**（globals.css `@theme`）：奶油白底 `#FDF8F4`（cream）/ 主粉 `#E885A8`（primary，主操作）/ 深粉 `#D96A92`（悬停）/ 粉底 `#FBEAF0` / 墨紫 `#4B4356`（ink，正文标题）/ 次墨紫 `#7E7589`（ink-soft）/ 丁香紫 `#B9A7D9`（lilac，次级点缀）/ 丁香底 `#F0EAF8`。
- **字体**：圆润字体栈 `"Yuanti SC","YouYuan","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui`（本机圆体/幼圆优先，无外部字体依赖——网络不可达时构建仍安全）。
- **组件样式**：主按钮胶囊形 + 柔和粉色阴影（`shadow-soft`）；输入框 `input-field`（圆角 + 丁香描边 + 主粉聚焦环）；卡片 `card-surface`（圆角 16 + 柔和阴影）；链接 `link-soft`（深粉下划线）。
- **签名元素**：`src/components/ui/ArcSignature.tsx` 手绘双弧线 + 端点四角星光（主粉/丁香双色、轻微不完美曲线），用于首页/认证页/帮助/关于/404/错误页顶部——全站唯一装饰签名。
- **不用**像素/豆粒/马赛克元素；错误/告警保留语义色（红/琥珀/绿），仅统一圆角。

## 实现记录

- 5 个认证页（登录/注册/找回/重置/验证）经 `AuthShell` 重设计：奶油底 + 卡片 + 弧线签名 + 「← 首页」返回链接；表单输入/按钮/链接全部换 token 组件类。
- 首页重构：弧线签名 + 墨紫标题 + 深粉标语；三步引导卡片化；上传虚线卡片圆角化；导航胶囊化；页脚链接粉色化。
- 工作台/我的设计/色板管理/帮助/关于/404/错误页整体统一：blue-600 主色全部经 CSS 变量替换为 primary 粉；灰色系输入/卡片统一为丁香描边 + 圆角；页签/比例选择改为胶囊。
- 移动端修复：生成状态行 `flex-wrap`（长文案 350px 不溢出）；DOM 级走查 12 个路由 350px 视口横向溢出全部为 0；触控目标 ≥44px（globals.css 既有规则保留）。
- **分享图**：`public/og.png`（1200×630，粉紫光斑 + 弧线签名 + 标题，无像素元素）。
- 可访问名/文案全部未动（E2E getByRole 依赖不变）；焦点环改为主粉色（统一在 globals.css）。
- 全量自测：单测 538 通过；E2E 54×3 浏览器全绿；typecheck/lint/build 绿；350px DOM 走查通过。

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
