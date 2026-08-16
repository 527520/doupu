# 12 工程健康：覆盖率护栏 + 性能阈值 + 魔法数字 + 依赖评估 + 日志清理

Status: ready-for-agent

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
