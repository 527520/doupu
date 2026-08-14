# 17: 账号入口与设计列表 UI

- Status: resolved

## 完成记录

- `src/app/designs/page.tsx` + `src/components/designs/DesignsView.tsx`：本地+云端设计网格（缩略图/名称/尺寸/更新时间/同步角标 已同步·未同步·仅本机·冲突）、新建→/app、打开→/app?id=（云端独有先拉取到本地）、重命名（≤100 字，本地+推送云端）、删除（二次确认；本地墓碑→同步推送→云端 DELETE；纯云端直接 DELETE）、空态/加载失败/云端失败（保留本地+手动重试同步）/冲突提示条。
- `src/components/account/AccountMenu.tsx`：游客（登录/注册入口）、已验证（邮箱+修改密码对话框+注销账号流程+退出登录）、未验证（重发验证邮件，60s 冷却）；`ChangePasswordDialog`（密码 8–72 校验+两次一致+服务端字段错误展示）、`DeleteAccountDialog`（密码确认，成功后通知刷新）。
- `src/lib/sync/api.ts`：fetch 实现（me/list/get/put/delete + resend/change-password/account/logout），401→游客、403→未验证、错误统一 ApiError{status,code,message,field}；可注入 fetchImpl。
- `src/lib/sync/clientAdapter.ts`：同步适配（本地记录+meta 墓碑 ↔ 云端列表 reconcile；推送采纳服务端 updatedAt 幂等；拉取写回本地；损坏项目跳过并记录；deleteLocal/renameLocal/pullDesign），8 个单测覆盖 E35–E37 与幂等。
- 消息：`designs:`/`account:` 命名空间定点追加。
- 测试 33 例全绿（同步引擎 12 + 适配 8 + 列表页 7 + 账号菜单 6）；typecheck/lint 绿。
- 已知缝位（记录备查）：工作台 `/app?id=` 的按 id 恢复由 T12 工作台后续接入；设计上限 409 提示文案已就位（limitError）。
