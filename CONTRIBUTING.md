# 贡献指南

感谢你对豆谱（DouPu）的关注！豆谱是 AGPL-3.0 开源软件，欢迎任何形式的贡献：报 bug、提建议、改文档、写代码。

## 提问与反馈

- 使用问题与功能建议：发到 [GitHub Issues](https://github.com/527520/doupu/issues)
- 联系作者：wuqian · wqa527520@qq.com

## 开发环境

要求：Node.js ≥ 20、npm。

```bash
npm ci
npm run dev        # http://localhost:3000
```

常用脚本：

| 命令 | 说明 |
|---|---|
| `npm run typecheck` | TypeScript 检查 |
| `npm run lint` | ESLint |
| `npm run test` | Vitest 单元/组件/API 测试（PGlite 进程内数据库，免 Docker） |
| `npm run test:e2e` | Playwright 三浏览器 E2E（先 `npx playwright install`） |
| `npm run build` | 生产构建 |

## 提交流程

1. Fork 本仓库并创建分支（`git checkout -b feature/xxx`）。
2. 修改代码，保持中文注释与文案风格一致。
3. 提交前自查：`npm run typecheck && npm run lint && npm run test -- --run` 全部通过。
4. 改动涉及页面交互时，补上对应 E2E 用例（`tests/e2e/`），并本地跑 `npm run test:e2e`。
5. 提交信息使用 Conventional Commits（如 `feat:`、`fix:`、`docs:`、`test:`），首行 ≤ 72 字符。

## 代码约定

- 全部界面文案从 `src/messages/zh-CN.ts` 引用，禁止在组件里硬编码字符串。
- 外部链接与常量集中在 `src/lib/appInfo.ts`。
- 纯逻辑放 `src/lib/` 并配单元测试；测试文件与源文件同目录（`*.test.ts` / `*.test.tsx`）。
- 数据库变更使用 Drizzle：修改 `db/schema.ts` 后执行 `npm run db:generate` 生成迁移，并保证 `db/models.test.ts`（迁移可重放幂等）通过。
- 架构决策记入 `docs/adr/`；规格与边界矩阵见 `.scratch/photo-to-pattern/spec.md` §6。

## 许可证

豆谱以 AGPL-3.0 发布。提交代码即表示你同意在 AGPL-3.0 下授权你的贡献。
本仓库包含基于 Zippland/perler-beads（AGPL-3.0）移植的内容，请保留出处声明（见 NOTICE.md），不要删除或改写来源注释。
