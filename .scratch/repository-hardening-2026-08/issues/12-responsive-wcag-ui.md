# 12 响应式 UI 与 WCAG 2.2 AA

Status: ready-for-human

Blocked by: 06, 07, 08, 11

## Outcome

全站共享响应式页头，手机端账户/保存操作可用；无重复 h1；Modal、画布、触摸与颜色对比满足 WCAG 2.2 AA；加载/空/错误反馈明确。

## Tracer Bullet

先让共享 Modal 通过焦点循环/恢复/inert 单测和 axe，再替换一个真实确认流程；随后将同一可访问组件与 header seam 推广全站。

## Implementation

- 统一 shared responsive header/navigation；移动端收拢低频操作但保持可发现。
- 页面仅一个 h1，修复语义层级和 live region。
- Modal focus trap、Escape、恢复焦点、背景 inert/aria-hidden。
- 画布键盘操作；普通滚轮不抢缩放，触摸允许页面滚动，手势文案与行为一致。
- 重建颜色 token，所有正常文本/控件满足 AA；Workbench upload/crop 也保留全局导航。
- 传递 mobile capture，补 loading/empty/error/offline 状态。

## Acceptance Tests

- 350/390/768/1280/1440px 无横向溢出或关键操作遮挡。
- axe 无严重/关键问题；键盘可完成核心流程；Modal 焦点不逃逸且关闭后恢复。
- iOS Safari 与 Android Chrome 触摸滚动、上传拍照、编辑/导出人工通过。

## Files

shared layout/header/Modal、Workbench/editor/crop/pages、CSS tokens、UI tests/E2E
