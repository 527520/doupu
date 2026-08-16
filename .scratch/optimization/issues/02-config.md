# 02 站点配置化

Status: ready-for-agent

## 目标（决策 D32）

把「改配置即生效」的参数集中管理，避免改一个数字要改代码发版：

1. 新建 `src/lib/config.ts`（服务端单一出口）：从环境变量读取、带默认值，供各模块引用。
2. 导出默认参数：PDF 格大小（默认 6mm）、页边距（默认 8mm）、每页行列；PNG 默认格子大小。
3. 生成默认参数：目标宽度、颜色数、抖动开关的默认值（与现有 DEFAULT_GENERATION_PARAMS 合并来源）。
4. 安全阈值：登录/注册/验证/重置限流次数与窗口、会话时长、请求体上限——环境变量化。
5. `.env.example` 同步补全说明与默认值。
6. 客户端需要可见的默认值（生成参数默认值）经现有 props 下发，不新增客户端读 process.env 的路径。

## 边界

- 不做管理界面；配置只读于启动/请求时。
- 值非法时回退默认值并在日志告警（fail-fast 仅保留已有的生产必备项：DATABASE_URL、APP_URL）。

## 验收

- 单测：非法/缺失环境变量回退默认；导出与生成默认值从 config 生效。
- 全量回归通过。

## 涉及文件

src/lib/config.ts（新）、src/lib/export/pdfLayout.ts、src/lib/export/pdf.ts、src/lib/export/png.ts、src/lib/types.ts（DEFAULT_GENERATION_PARAMS 来源）、src/lib/auth/rateLimit.ts、src/lib/auth/cookies.ts、src/lib/auth/http.ts、.env.example
