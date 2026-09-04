# 07 独立治理后台、人员与系统信息

Status: ready-for-agent

Blocked by: 02, 03, 04, 05, 06

## Outcome

`/admin` 提供分权的审核校样台、可访问分析图表、人员治理、审计与真实系统状态；移动端使用列表到详情单列流程。

## Tracer Bullet

moderator 可完成作品审核但访问分析和人员模块得到 403；admin 在键盘流程中完成筛选、预览、带理由处置并看到相应审计。

## Acceptance Tests

- 页面和每个 Route Handler 均就地鉴权，layout 不是唯一屏障。
- SVG/CSS 图表有文本摘要、可聚焦数据点和数据表，不只依赖颜色。
- 350/390/768/1280/1440 px、axe、键盘和 reduced-motion。
- 系统页显示应用/迁移/维护真实状态，备份明确为“未接入”。
