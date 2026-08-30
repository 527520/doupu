# Vendored pindou-color-data

- 上游：https://github.com/HansBug/pindou-color-data
- 固定 commit：`178dafbc9e77d3de556550dbd058270200129186`
- 许可证：MIT（见本目录 `LICENSE`）
- 上游 `manifest.json` SHA-256：`913360c7ac88f943cc8d058f7d1a0f66020b0004404729a6f9765d79dbc087de`
- 上游 `LICENSE` SHA-256：`7ce773e89d6ae09c6c6ea0d2ec202648f57f25a259634039aea3f57f9895e97e`

本目录不使用 git submodule。应用所需的八套数据由显式脚本生成到 `src/lib/palettes/data/pindou-color-data.generated.json`，生产运行时不会访问网络。

应用持久化 ID 使用 `pcd:<上游ID>@178dafbc9e77d3de556550dbd058270200129186`；下表只列上游源 ID。

重新导入：

```bash
git -C /path/to/pindou-color-data checkout 178dafbc9e77d3de556550dbd058270200129186
node scripts/import-pindou-color-data.mjs --source /path/to/pindou-color-data
node scripts/import-pindou-color-data.mjs --source /path/to/pindou-color-data --check
```

导入器只读取固定 commit 的文件内容，同时核对独立锁定的 SHA-256；选定文件有未提交修改时拒绝执行。`--check` 只比较生成产物，不重写文件。

| 内置 ID | 上游文件 | SHA-256 |
| --- | --- | --- |
| `mard-291-github` | `mard-291-github/colors.json` | `baa8e0a4a414cb45dfb62859ac2a4a8ec23a887498fdf8405d2ec96c90148455` |
| `coco-291` | `coco-291/colors.json` | `46336ae0b4bd267041f49d339c459edc938af33b2370846c0245dff7e0b504a0` |
| `manman-278` | `manman-278/colors.json` | `cfa0823b2114e196c90f2a54d428a7af5354634cad2ccb390a873ba6b9ffce71` |
| `panpan-289` | `panpan-289/colors.json` | `853168b6a78527fffeeb58d1dc4fab79c999c2a029c92dd05b9167898f43c105` |
| `mixiaowo-290` | `mixiaowo-290/colors.json` | `1a6c19b8a0e433f98fd1ddbafede344b96469ecb15153bcba388ea06cc4ffbe0` |
| `mard-221-alfonse-doudou` | `mard-221-alfonse-doudou/colors.json` | `556a7e0098c0055bde47f78d430cc7d36cb3788c235f0238e6a610f64a46b0bf` |
| `artkal-c-197-official` | `artkal-c-197-official/colors.json` | `8a5dbc16187a73e3266718d24d7c95da5a38437567e93e021ab3eb778a704a61` |
| `artkal-m-221-official` | `artkal-m-221-official/colors.json` | `82a6f68b121741b2721ea0f7b1e2a5bcc03aa64c2d2e50d755d17a4a6700c17b` |

未导入的上游系列：`mard-221-github`（291 色版的子集）、`artkal-c197-m221-418-official`（C/M 合并表）、`youken-public-174`（旧表）。
