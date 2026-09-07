# 验证记录（2026-09-07，本机 macOS，Next 16 dev + PGlite）

不声称真机或生产验证；生产部署前仍须按发版流程走 PostgreSQL 16 / Docker 门禁。

## 静态与单元

- `npm run lint`：0 错误 0 警告。
- `npm run typecheck`：通过（先删除过期的 `.next/types` 与 `.next-e2e/types`——它们引用上一轮已删除的 `/admin/rules` 与 `moderation-rules` 路由，由构建重新生成）。
- `npm run build`：通过（prebuild 协议预检、PDF 字体子集 3.20 MB、63 个 UI 字体校验均通过）。
- `npm run test`：193 文件 / 1540 通过 / 13 跳过；2 个断言随 `<details>` → `Disclosure` 同步更新（`PalettePicker.test`、`Workbench.test` 改为断言触发器 `aria-expanded="false"`）。`tests/unit/nextConfig.test.ts` 在沙箱内因 `uv_interface_addresses` 被禁而报错，沙箱外单独运行通过（2/2）。
- 新增单测：`ui/Button.test`（Button / IconButton）、`ui/FormControls.test`（DatePicker 清除 / 今天 / 点选、DateRangePicker 近 7 天、NumberField 边界与清空、Disclosure、Checkbox、Textarea、Chip / Badge / EmptyState）、`security/publicThrottle.test`（页面节流窗口与键上限、游标签名与篡改拒绝、限流键、Retry-After、零宽字符归一化、sitemap 分页）、`db/communityInteractions.test` 评论游标分页（第 31 条可达、非法游标 VALIDATION）、`db/communityQueries.test` 匿名 DTO 不含快照与伪造游标拒绝、`CommunityInteractions.test` 删除二次确认与「加载更多」追加。

## E2E（Playwright，自带 3100 端口 dev 服务器）

- Chromium：首轮 82 通过 / 5 失败 / 2 跳过。5 个失败全部是本轮界面变化带来的选择器或期望漂移，已修复并在对应三个文件重跑 22/22 通过：
  1. `12` 官方批次用例仍用 `.batch-studio > details` 与 `getByLabel` 定位数字输入 → 改为折叠按钮 + `textbox` + 失焦提交；
  2. `16` 「恢复已保存批次」文案在折叠摘要与面板内 `h3` 各出现一次（strict mode）→ 面板内去掉重复标题；
  3. `17` 拖入态期望整块莓果实心底 → 改为断言钉板落区的粉底与莓果描边；
  4. `17` 无 JS 降级：`Disclosure` 折叠面板在无 JS 下不可展开 → `Disclosure` 未水合时渲染原生 `<details>`；
  5. `17` 200% 布局放大 392 > 390 → 首页主按钮允许换行、限宽。
  最终 Chromium 全量重跑：87 通过 / 2 跳过 / 0 失败（4.7 分钟）。
- Firefox：78 通过 / 11 跳过 / 0 失败（5.3 分钟）。
- WebKit：80 通过 / 9 跳过 / 0 失败（4.9 分钟）。
- axe（`15`、`17` 内置）：serious / critical 零违规。

## 五宽度与截图

`evidence/` 内 18 张：首页、豆社列表、详情（匿名 + 登录）、后台总览、审核台、官方批量、使用统计、人员管理，各取 350 与 1440；350 / 390 / 768 / 1280 / 1440 五宽度 `scrollWidth ≤ 视口宽度` 全部成立（脚本逐页测量，无横向溢出）。

## 前后对照（关键点）

| 位置 | 之前 | 现在 |
|---|---|---|
| 首页选图 | 整块莓果实心 + 3D 阴影 | 钉板纹理落区 + 一枚紧凑主按钮；拖入时钉阵变莓果色 |
| 按钮 | 6 种 CSS 类、35 个无 class 裸按钮、`btn-ghost` 未定义、评论区彩色小字 | `Button` 四种语气 + 圆形豆粒 `IconButton`（垃圾桶 / 心 / 旗 / 铅笔）；不再有无边框彩色小字 |
| 日期 / 数字 / 折叠 | 原生 `type=date`、`type=number`、17 处裸 `<details>` | react-aria 品牌化 DatePicker / DateRangePicker / NumberField / Disclosure（无 JS 退回原生） |
| 详情页 | 右栏 10 段堆叠 | 标题与动作行 → 图纸舞台 + 制作卡 → 讨论区（评论游标分页、删除二次确认） |
| 评论 | 15 分钟可编辑 | 只能发表与删除（ADR-0022） |
| 后台 | 编号导航、页头横向散开、每页弹统计同意 | 图标 + 待办角标导航、总览页、统一页头与共享组件、后台不弹横幅 |
| 官方批量 | 单页堆叠、48×48 预览拉满卡片 | 四步流程、服务端带格线缩略图、制作规格可选、50 项批次不再重画全部卡片 |
| 反爬 | 公开面无节流、sitemap 全量、明文游标、匿名可拿完整图纸 JSON | 页面 + 接口按 IP 节流、写接口限流、sitemap 分页截断、游标签名、匿名只看大图（ADR-0021） |

## 遗留

- `GenerationParamsPanel`（工作台）的数字输入保留原生 `type=number`（见 issue 02 备注）。
- 页面级节流是进程内计数，多实例部署需改共享存储（ADR-0021 已注明）。
- 开发环境 sitemap / robots 对进程内 PGlite 不可见，退回静态条目；生产走 PostgreSQL。
