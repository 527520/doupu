# 08 验证门禁

Status: ready-for-agent
Completion: in-progress

## 范围

- 单测更新与新增（Menu、Segmented 滑块、DatePicker 整块点击、Button loading）。
- E2E 17 扩展：分段滑块位移、日期字段整块点击、审核台顶边对齐、筛选行底边对齐、禁用主按钮 opacity 为 1、空白起稿主按钮、reduced-motion 恒等变换保留。
- 五宽度 × 三浏览器截图到 `evidence/`；axe 零违规。
- `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build`。

## Comments

- lint / typecheck / 全量 vitest / 生产构建已通过；E2E 与截图对照因代理沙箱无法启动浏览器与稳定运行 dev 服务器而未在本机完成，见 [verification.md](../verification.md)。
- 第一轮 E2E（用户终端）27 个失败已逐个定位并修复：弹窗 / 抽屉 / 菜单入场不再动 transform、opacity、backdrop-filter；审核台并排改 subgrid 对位；紧凑下拉抽屉修掉「按下即开、松手误选」的真实 bug（`shouldSelectOnPressUp={false}`）；E2E 断言改在浏览器内解析矩阵；E2E 环境放开豆社写限流。第二轮 E2E 239 通过 / 12 失败，已再定位修复：高级选项折叠时不挂载（首次提交 50ms 预算）、axe 前等动效落定、日期字段捕获阶段开月历（修掉单测假阳性）、WebKit 抽屉入口先聚焦再打开、色板卡片 hover 不位移、Firefox 亚像素容差；firefox 02 取消 128ms 疑为时序噪声，待单独重跑确认。第三轮 244 通过 / 7 失败，再修：图纸落地提交改为过渡渲染（分片让出主线程）、axe 前的静止判定改轮询并识别加载态、后台筛选条改两段式（搜索 + 查询同行，其余筛选整行）。第四轮 249 通过 / 2 失败：竖长图裁剪弹层逼预览重绘 + 隐藏导出仍扫 2 万格（桌面导出改为打开才挂载、裁剪/生成中预览暂停）；首页钉板主按钮加白渐变只有 4.37:1（主按钮不再加白）。第五轮 246 通过 / 5 失败：卸掉桌面导出让 E2E 02 找不到「下载 PNG」；方图阶段 52ms+60ms 长任务（万格 fillRect + 裁剪弹层 Retina 缓冲）；350px 游客菜单仍不足 44px。已改回 hidden 挂载、PNG 规划懒做、ImageData 分帧绘制、裁剪缓冲封顶并延后像素上传、菜单打开即终态。第六轮全量 E2E 在用户终端通过。
