# 09 举报后台缺少被举报对象的内容和定位入口

Status: ready-for-agent
State: closed
Resolution: implemented-and-verified
Closed: 2026-09-05
Priority: P2
Baseline: 6f44fbc
Verified: 2026-09-05

## Location

src/components/admin/GovernanceConsole.tsx:54–57；src/components/community/CommunityInteractions.tsx:79–83,100–102

## Reproduction

通过公开界面的作品或评论举报按钮提交举报，再打开举报后台。

## Actual

普通举报不填写 details；后台仅展示 body/details 的兜底无详情，没有目标内容、目标 ID、目标版本或跳转入口，只有接受、驳回、结案。

## Expected

管理员能确定被举报对象及版本、查看必要上下文并执行有依据的处置。

## Evidence

静态界面、举报提交与后台接口调用链核实；未执行浏览器走查。

## Acceptance

无补充说明的作品/评论举报仍可识别与核查目标；目标变更或不可公开时给出明确上下文；保持权限和理由要求。

## Comments

- 2026-09-05：按用户请求登记，尚未修复。当前后续任务为只读体验探索。

## Fix and verification

- 2026-09-05：用户授权主会话实施修复，原只读记录阶段结束。
- 新增管理员／审核员专用案件材料读取接口，按被举报作品修订加载完整冻结图纸；评论只提供当前版本并标明变化或删除。后台展示编号、版本、状态、内容和公开定位入口；越权 401／403、下架作品、更新／删除评论测试通过。
- 针对性回归、完整本地门禁与双轴复核均已通过；实现提交 `8c1d986`、`629937e`，验证细节与证据边界见 [审查记录](../spec.md)。本票无剩余实施项。
