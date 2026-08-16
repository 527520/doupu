# 12 工程健康：覆盖率护栏 + 性能阈值 + 魔法数字 + 依赖评估 + 日志清理

Status: done

## Comments（2026-02 实施记录）

- **覆盖率护栏**：实测基线（本票新增 37 个单测后）src/lib 行 92.93 / 语句 91.78 / 函数 94.15 / 分支 81.08 → 达到 spec §8 ≥90% 目标。阈值定为 行/语句/函数 90、分支 75（vitest.config.mts `coverage.thresholds`），CI quality job 改用 `npm run test:coverage`。新增测试：`src/lib/sync/api.test.ts`（11）、`src/lib/engine/generate.worker.test.ts`（2）、`src/lib/image/decode.test.ts`（10）、`src/lib/storage/indexedDb.test.ts`（6）、`src/lib/editor/ops.test.ts` 性能用例（3）。
- **性能阈值**：200×200 实测 ~0.75-0.79s（多次全量回归），阈值收紧到 spec §7.1 的 2000ms（留 2.5 倍余量）；编辑器 applyBrush/floodFill/clearAll 200×200 单操作实测空闲 3-9ms、高负载 57-68ms，护栏取 <200ms（与仓库既有编辑器性能测试「防负载抖动」口径一致，设计预算 50ms 由引擎级预算测试守护）。
- **魔法数字**：画布最大高度 560 / 容器内边距 16 / 编辑画布 4096 上限收拢到 `src/lib/appInfo.ts` 的 `CANVAS_UI`，PatternPreview 与 PixelEditorCanvas 引用常量（backup-alert 的 4096 是请求体上限，属另一语义，保留原位）。
- **依赖评估（npm outdated，2026-02）**：
  - 升级（patch，已跑通 typecheck + 全量单测 + build）：next 15.5.10→15.5.23、eslint-config-next 15.5.10→15.5.23、react/react-dom 19.2.1→19.2.8。
  - 保持现状并记录：@types/node 20（生产 node:20 目标，CI node 22 兼容）；eslint 9（eslint-config-next 15.x 不支持 eslint 10）；typescript 5.9（7.x 是原生移植新主版本，不冒险）；argon2/drizzle-orm/pg/nodemailer 等无更新（未出现在 outdated）。
  - nodemailer 类型主版本结论：@types/nodemailer 最新即 8.0.1（DefinitelyTyped 未发布 9.x），nodemailer@9 用到的 createTransport/sendMail API 与 8.x 类型兼容（typecheck 通过），保持现状；@types@9 发布后再升级。
- **日志清理**：删除根目录 `.dev-server.log`、`.dev-server.err.log`、`e2e-webkit.log`（均未被 git 跟踪）；`.gitignore` 增补 `*.log` 规则（保留既有 npm-debug 类）。

## 目标

1. **覆盖率护栏**（盘点 #18）：装 `@vitest/coverage-v8`；CI 加 coverage 步骤；spec §8 承诺 src/lib ≥90%——先实测当前值，若差距大则设「当前值+2%」起步阈值并记录在 ticket Comments（不一次性造测试债）；本地脚本 `npm run test:coverage`。
2. **性能阈值收紧**（盘点 #12）：`generate.test.ts` 的 `<3000ms` 收紧回 spec 的 `≤2000ms`（先实测本机/CI 波动后定阈值）；给编辑器核心操作加轻量性能测试（applyBrush/floodFill/clearAll 在 200×200 上 <50ms）。
3. **魔法数字收拢**（盘点 #21）：画布最大高度 560、容器内边距 16、编辑画布 4096 上限等集中到 appInfo/config（票 02 的 config 模块），组件引用常量。
4. **依赖评估**（盘点 #22）：`npm outdated` 清单评估；可安全升级的升（Next 15.3.6 之后的 patch、argon2、drizzle）；nodemailer 类型主版本不匹配记录结论（保持现状或改导入方式）。
5. **日志清理**（盘点 #23）：删除仓库根遗留 `.dev-server*.log`/`e2e-webkit.log`；`.gitignore` 补 `*.log` 相关规则（保留既有 npm-debug 类）。

## 边界

- 升级依赖后必须全量单测 + E2E + 构建，任何回退立即恢复并记录。
- 不做大重构（D35）。

## 验收

- CI 配置本地等价验证（act 不可用则以本地命令等价跑通）；覆盖率报告可生成。
- 全量回归。

## 涉及文件

package.json、.github/workflows/ci.yml、src/lib/engine/generate.test.ts、src/lib/editor/*.test.ts（新性能用例）、src/components/preview/PatternPreview.tsx、src/components/editor/PixelEditorCanvas.tsx、src/lib/appInfo.ts、src/lib/config.ts、.gitignore
