# 色板数据来源

`colorSystemMapping.json` 逐字复制自上游开源项目：

- 仓库：https://github.com/Zippland/perler-beads
- 原路径：`src/app/colorSystemMapping.json`
- 许可证：AGPL-3.0（本项目同样以 AGPL-3.0 发布，出处声明见根目录 `NOTICE.md`）

内容：291 个标准 hex 颜色，每个颜色映射到 5 个国产拼豆品牌（MARD、COCO、漫漫、盼盼、咪小窝）的色号。
个别颜色在某个品牌下没有对应色号，值为 `"-"`，代码中归一化为 `null`（该颜色在该品牌下不可用，spec 边界 E19）。

## 已知上游数据缺陷（如实记录，不臆改）

- 漫漫品牌下 `#7FCD9D` 与 `#F3C1C0` 共用色号 `S4`（上游 `色号对应表.csv` 同样如此，系卖家色卡本身的重复）。
  处理：匹配逻辑不受影响（两个 hex 均参与最近色匹配，仅图纸色号显示相同）；`validateColorSystemData`
  会报告此项，测试将其作为白名单锁定，防止未来编辑引入新的重复。

## 完整性约束（`src/lib/palettes/index.ts` 中 `validateColorSystemData` 程序化断言）

- 恰好 291 个条目；
- 每个 hex 合法（`#RRGGBB`）；
- 每个品牌在每个 hex 下都有取值（色号或 `"-"`）；
- 每个品牌的非空色号在其品牌内唯一（除上述已记录的 S4 外）。

交叉验证：`tests/fixtures/color-system-table.csv` 为上游根目录 `色号对应表.csv` 的逐字副本（UTF-8 带 BOM），
由 `src/lib/palettes/index.test.ts` 断言其与 JSON 数据一致。上游 CSV 个别单元格为多候选值（如 `157/70`），
以 JSON 已选定的值为准进行包含式比对。
