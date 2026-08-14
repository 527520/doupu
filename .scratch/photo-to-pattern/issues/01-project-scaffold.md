# 01: 项目脚手架与工程基础

- Status: claimed
- Blocked by: 无

## 目标

在仓库根建立豆谱的工程基础：git 仓库、Next.js 15.3.6 脚手架、质量工具链、许可证与出处声明、文案模块。

## 范围

- `git init`（.gitignore：node_modules、.env*、.next、.scratch/photo-to-pattern/upstream/、playwright-report、coverage）。
- Next.js 15.3.6 + App Router + TypeScript（strict）+ Tailwind 4 + ESLint，目录用 `src/`。
- 测试链：Vitest（单元）、Playwright（E2E，Chromium/Firefox/WebKit）。
- CI：GitHub Actions workflow（lint → typecheck → unit → build；E2E 工作流骨架留 T20 完善）。
- 许可证与出处：`LICENSE`（AGPL-3.0 全文，参照上游 LICENSE 结构 + 中文声明引用）、`NOTICE.md`（上游 Zippland/perler-beads AGPL-3.0 出处）、所有源文件头注释约定。
- 文案模块：`src/messages/zh-CN.ts` 集中全部 UI 文案（占位结构：通用、错误码文案、各页面命名空间）。
- 默认首页替换为豆谱占位页（含页脚：开源链接占位、备案号占位）。
- 首次提交：docs/、CONTEXT.md、.scratch/photo-to-pattern/{spec.md,issues,research}（不含 upstream/）与脚手架。

## 不含

- 任何业务功能（T02 起）；E2E 用例内容（T20）；部署产物（T21）。

## 规格引用

- ADR-0001（许可证）、ADR-0002（架构）、ADR-0006（测试）；spec §7.2、§9。

## 验收标准

- [ ] `npm run lint`、`npm run typecheck`、`npm run test`、`npm run build` 全绿（含至少一个示例单测）。
- [ ] `npx playwright --version` 可用，`playwright.config.ts` 就绪（三浏览器项目声明）。
- [ ] LICENSE 为 AGPL-3.0 全文；NOTICE 注明上游出处；脚手架占位页替换完成。
- [ ] 无硬编码中文散落在组件中（文案走 src/messages/zh-CN.ts）。
- [ ] CI workflow 文件存在且语法有效。

## 完成记录

（resolve 时填写实现要点与测试命令输出摘要）
