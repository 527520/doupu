# NOTICE

豆谱（DouPu）基于以下开源项目二次开发，遵守其 AGPL-3.0 许可证要求，保留出处声明。

## 上游项目

### Zippland/perler-beads

- 仓库：https://github.com/Zippland/perler-beads
- 许可证：AGPL-3.0
- 用途：产品概念的来源；以下内容移植自该项目（保留出处注释）：
  - 五套国产拼豆品牌色板数据（现拆分锁定在 `src/lib/palettes/data/legacy/*.generated.json`，源自其 `src/app/colorSystemMapping.json`，291 色 × MARD/COCO/漫漫/盼盼/咪小窝；漫漫 `#F3C1C0` 的色号由上游 `S4` 本地纠正为 `S7`）
  - Oklab 感知颜色距离公式与最近色匹配思路（`src/lib/engine/color.ts`）
  - 格元代表色采样规则（主色/平均色，透明阈值 128）
  - 相似颜色频率合并思路（原为全局频率合并，本项目重构为按目标颜色数二分阈值）
  - 边界洪泛背景去除思路
- 其 `色号对应表.csv` 用作色板数据交叉验证的测试 fixture。

### liangdabiao/perler-beads-ai

- 仓库：https://github.com/liangdabiao/perler-beads-ai
- 说明：仅作功能参考（图片裁剪交互）。本项目不采纳其 AI 相关功能，亦不采纳其 Apache-2.0 声明（该再许可对 AGPL 上游无依据）。

### HansBug/pindou-color-data

- 仓库：https://github.com/HansBug/pindou-color-data
- 固定 commit：`178dafbc9e77d3de556550dbd058270200129186`
- 许可证：MIT，Copyright (c) 2026 HansBug；许可证全文见 `third_party/pindou-color-data/LICENSE`
- 用途：八套独立拼豆色卡的展示数据与引擎候选色来源：MARD 291、COCO 291、漫漫 278、
  盼盼 289、咪小窝 290、MARD 221 核对版、Artkal C 197、Artkal M 221。
- 导入产物：`src/lib/palettes/data/pindou-color-data.generated.json`；由
  `scripts/import-pindou-color-data.mjs` 从上述固定 commit 显式生成。文件级 SHA-256 与未导入系列说明见
  `third_party/pindou-color-data/README.md`。

## 依赖许可

第三方 npm 依赖的许可证以各自包声明为准（Next.js/MIT、React/MIT、Tailwind CSS/MIT、pdf-lib/MIT、Drizzle ORM/Apache-2.0、argon2/MIT 等）。

## 字体

PDF 导出嵌入 **Noto Sans CJK SC**（OFL-1.1，SIL Open Font License）：
- 来源：https://github.com/notofonts/noto-cjk（Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf）
- 字体文件：`public/fonts/NotoSansCJKsc-Regular.otf`；许可全文：`public/fonts/OFL.txt`
- 用途：打印版 PDF 的中文页眉、图例与清单文本（pdf-lib + fontkit 子集嵌入）。
- 构建期还会生成 `public/fonts/NotoSansCJKsc-Regular.subset.otf`（GB2312 全字子集，
  约 3.2 MB，供浏览器按需下载；生僻字回退全量字体）。子集工具为
  [subset-font](https://github.com/papandreou/subset-font)（HarfBuzz WASM，MIT），
  见 `scripts/build-pdf-font-subset.mjs`。

界面同源字体（随仓库交付，OFL-1.1）：
- 正文使用 Noto Sans SC 2.004 可变字体的子集 **DouPu Text**；少量宣传标题使用寒蝉全圆体 3.000 的子集 **DouPu Round**。
- 上游固定提交、源文件与许可证见 `assets/ui-fonts/README.md`；生成子集更改了字体内部名称，保留原作者版权/许可/归属信息，不使用上游保留名称作为修改版名称。
- 分段 WOFF2、CSS、校验清单位于 `public/fonts/ui/`；扩展汉字按 `unicode-range` 加载，不上传用户文字。普通构建只离线校验，不下载或生成字体。
- 重新生成使用 `scripts/build-ui-font-subset.mjs`、已有 subset-font/HarfBuzz 与仅资产制作所需的 FontTools 4.60.1（MIT，`scripts/rename-ui-font.py`）。FontTools 不是应用运行/构建依赖。

## 本项目许可

豆谱整体以 AGPL-3.0 发布，详见 `LICENSE`。

- 版权所有：© 2026 wuqian（https://github.com/527520）
- 项目仓库：https://github.com/527520/doupu
