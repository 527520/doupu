# 色板数据来源与生成方式

内置色板目录由两组固定数据组成：豆谱既有五套，以及固定到
`HansBug/pindou-color-data@178dafbc9e77d3de556550dbd058270200129186` 的八套独立色板。
运行时不联网，也不使用 git submodule。

## 豆谱既有五套

`colorSystemMapping.json` 基于上游开源项目，并包含下述一项已批准的色号纠错：

- 仓库：https://github.com/Zippland/perler-beads
- 原路径：`src/app/colorSystemMapping.json`
- 许可证：AGPL-3.0（本项目同样以 AGPL-3.0 发布，出处声明见根目录 `NOTICE.md`）

内容：291 个标准 hex 颜色，每个颜色映射到 5 个国产拼豆品牌（MARD、COCO、漫漫、盼盼、咪小窝）的色号。
个别颜色在某个品牌下没有对应色号，值为 `"-"`，代码中归一化为 `null`（该颜色在该品牌下不可用，spec 边界 E19）。

目录运行时不再从共享矩阵构建五套色板。以下五个独立紧凑文件由
`node scripts/split-legacy-palette-data.mjs` 从矩阵生成，并用 golden hash 锁定 code、hex 与顺序：

- `legacy/mard.generated.json`
- `legacy/coco.generated.json`
- `legacy/manman.generated.json`
- `legacy/panpan.generated.json`
- `legacy/mixiaowo.generated.json`

旧矩阵只作为紧凑色板的生成源，并用于数据完整性与上游交叉验证；
运行时和业务测试均只通过公共色板目录取数。
可用 `node scripts/split-legacy-palette-data.mjs --check` 只读校验现有生成产物。

## 漫漫 S7 本地纠错

- 上游 `色号对应表.csv` 把漫漫 `#7FCD9D` 与 `#F3C1C0` 都记为 `S4`。
- 豆谱经确认将 `#F3C1C0` 修正为 `S7`，`#7FCD9D` 仍为 `S4`。这是本地明示纠错，
  不代表上游文件本身已修改。
- 纠错仅改变这一条的色号；291 个 HEX 及其顺序均不变。当图纸命中该颜色时，
  输出色号会从旧的 `S4` 变为 `S7`，不保留旧 golden 兼容。

## 完整性约束

- 恰好 291 个条目；
- 每个 hex 合法（`#RRGGBB`）；
- 每个品牌在每个 hex 下都有取值（色号或 `"-"`）；
- 每个品牌的非空色号在其品牌内唯一。

上述约束由 `src/lib/palettes/index.test.ts` 直接读取生成源矩阵验证，
生成源与五个紧凑产物的一致性由 `scripts/split-legacy-palette-data.mjs --check` 验证。

交叉验证：`tests/fixtures/color-system-table.csv` 仍为上游根目录 `色号对应表.csv` 的逐字副本（UTF-8 带 BOM），
不把本地纠错伪装成上游原文。`src/lib/palettes/index.test.ts` 要求除上述唯一纠错外全部一致；
上游 CSV 个别单元格为多候选值（如 `157/70`），以 JSON 已选定的值为准进行包含式比对。

## pindou-color-data 八套

`pindou-color-data.generated.json` 由以下命令显式生成：

```bash
git -C /path/to/pindou-color-data checkout 178dafbc9e77d3de556550dbd058270200129186
node scripts/import-pindou-color-data.mjs --source /path/to/pindou-color-data
node scripts/import-pindou-color-data.mjs --source /path/to/pindou-color-data --check
```

导入器从固定 commit 读取字节，并同时核对独立锁定的文件 SHA-256；选定文件有未提交修改时拒绝执行。
`--check` 只比较现有产物，不重写文件。

导入：MARD 291、COCO 291、漫漫 278、盼盼 289、咪小窝 290、MARD 221 核对版、
Artkal C 197、Artkal M 221。目录不公开上游的 MARD 221 源码子集、Artkal 418 合并表及优肯 174 旧表。

外部色板的持久化 ID 带完整来源版本，例如
`pcd:mard-291-github@178dafbc9e77d3de556550dbd058270200129186`；裸上游 ID 不是兼容别名。

展示数据保留完整顺序，包括透明色、不可辨认色号及重复 HEX。`engineColors` 只保留：

- 合法的 `#RRGGBB`；
- 可辨认且非空的真实色号；
- 每个 HEX 的首个上游色号。

Artkal 的 10 个 RGBA 透明色、盼盼/咪小窝各 4 个 `UNKNOWN-*`、COCO 的 2 个重复 HEX、
漫漫的 1 个重复 HEX 不会进入生成引擎，但会在完整展示数据中带明确排除原因。

许可证、上游文件 SHA-256 与重新导入说明见 `third_party/pindou-color-data/README.md`。
