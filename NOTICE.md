# NOTICE

豆谱（DouPu）基于以下开源项目二次开发，遵守其 AGPL-3.0 许可证要求，保留出处声明。

## 上游项目

### Zippland/perler-beads

- 仓库：https://github.com/Zippland/perler-beads
- 许可证：AGPL-3.0
- 用途：产品概念的来源；以下内容移植自该项目（保留出处注释）：
  - 五套国产拼豆品牌色板数据（`src/lib/palettes/data/colorSystemMapping.json`，源自其 `src/app/colorSystemMapping.json`，291 色 × MARD/COCO/漫漫/盼盼/咪小窝）
  - Oklab 感知颜色距离公式与最近色匹配思路（`src/lib/engine/oklab.ts`）
  - 格元代表色采样规则（主色/平均色，透明阈值 128）
  - 相似颜色频率合并思路（原为全局频率合并，本项目重构为按目标颜色数二分阈值）
  - 边界洪泛背景去除思路
- 其 `色号对应表.csv` 用作色板数据交叉验证的测试 fixture。

### liangdabiao/perler-beads-ai

- 仓库：https://github.com/liangdabiao/perler-beads-ai
- 说明：仅作功能参考（图片裁剪交互）。本项目不采纳其 AI 相关功能，亦不采纳其 Apache-2.0 声明（该再许可对 AGPL 上游无依据）。

## 依赖许可

第三方 npm 依赖的许可证以各自包声明为准（Next.js/MIT、React/MIT、Tailwind CSS/MIT、pdf-lib/MIT、Drizzle ORM/Apache-2.0、argon2/MIT 等）。

## 字体

PDF 导出嵌入 **Noto Sans CJK SC**（OFL-1.1，SIL Open Font License）：
- 来源：https://github.com/notofonts/noto-cjk（Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf）
- 字体文件：`public/fonts/NotoSansCJKsc-Regular.otf`；许可全文：`public/fonts/OFL.txt`
- 用途：打印版 PDF 的中文页眉、图例与清单文本（pdf-lib + fontkit 子集嵌入）。

## 本项目许可

豆谱整体以 AGPL-3.0 发布，详见 `LICENSE`。
