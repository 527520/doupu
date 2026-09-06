# 豆谱上线检查单（腾讯云海外地域）

> 适用：单机 Docker 部署（ADR-0005）。以下步骤仅能由账号所有者本人完成；按顺序执行，每步完成后勾选。
> 当前决策 D31 为海外节点，不填写或展示 ICP 备案号。若将来迁入中国大陆地域，必须先另立合规决策并完成备案，不能直接复用本清单切流。

## 第 0 步：发布源码到 GitHub（开源合规，ADR-0001）

- [ ] 登录 github.com/527520，新建仓库 **doupu**（Public，不勾选任何初始化文件——仓库已有完整历史）。
- [ ] 本地执行（Windows 凭据管理器会处理认证；若提示登录，按指引完成）：
  ```powershell
  git push -u origin main
  ```
- [ ] 确认 https://github.com/527520/doupu 可访问，Actions 页 CI 全绿。
- [ ] （可选）`git tag v0.1.0 && git push origin v0.1.0` 触发 release 工作流构建 GHCR 镜像。

## 第 1 步：购买服务器

- [ ] 登录腾讯云控制台（实名认证为个人）。
- [ ] 购买海外地域「轻量应用服务器」（例如中国香港/新加坡）：2 核 2 GB 内存、系统盘 ≥ 40 GB、带宽 ≥ 3 Mbps，系统镜像选 **Ubuntu 22.04 LTS**（或 Debian 12）。
- [ ] 记录：公网 IP、地域，并确认不是中国大陆地域。
- [ ] 防火墙（安全组）放行：`22`（SSH，建议限制来源 IP）、`80`、`443`。
- [ ] 设置 SSH 登录：推荐密钥登录，禁用密码登录（`/etc/ssh/sshd_config` 中 `PasswordAuthentication no`）。

## 第 2 步：注册域名（DNSPod）

- [ ] 在腾讯云域名注册页查询并购买域名（首选 `doupu.cn` / `doupu.com`；若已注册，依次尝试 `doupu.net`、`doupuapp.com`、`doupu.fun`）。短拼音 .com 大概率已被抢注，不必强求。
- [ ] 完成域名实名认证（个人，身份证，通常 1–2 小时内完成）。
- [ ] 记录域名与 DNSPod 管理权限，待服务器安全加固完成后解析。

## 第 3 步：部署地域合规确认

- [ ] 再次确认实例、公网 IP 与实际入口均在海外地域，不经过未备案的中国大陆源站。
- [ ] 页脚不展示虚构或占位 ICP 备案号。
- [ ] 若架构、地域或域名合规要求变化，停止发布并先更新 ADR/本清单。

## 第 4 步：域名解析与 TLS

- [ ] 安全加固完成后，在 DNSPod 添加解析：`@` 与 `www` 的 A 记录 → 服务器公网 IP。
- [ ] `nslookup <域名>` 确认解析生效。
- [ ] TLS 证书无需手动购买：Caddy 首次启动自动申请 Let's Encrypt 证书并自动续期（前提：80 端口可达、解析已生效）。

## 第 5 步：邮件推送（腾讯云 SES）

- [ ] 开通「邮件推送 SES」，创建发信域名（用主域名即可），按指引添加 SPF 与 DKIM 的 DNS 记录并验证。
- [ ] 创建发信地址（如 `noreply@<域名>`）。
- [ ] 获取 SMTP 凭证（账号/密码），填入服务器 `.env`（`SMTP_*` 变量，见 `.env.example`）。

## 第 6 步：对象存储（COS：数据库备份 + 作品原图）

- [ ] 创建一个 COS 存储桶（如 `doupu-<地域>`），**私有读写**；不开公有读、不配 CDN。备份写在 `doupu-backup/` 前缀，作品原图（D49）写在 `originals/` 前缀，应用只通过服务端代理读写原图，浏览器永不直连该桶。
- [ ] **不要**给这个桶配自动删除的生命周期规则：原图跟随作品生命周期由应用删除（作者撤回 / 注销即删；下架 30 天未恢复由维护任务删除），整桶或无前缀限定的过期规则会把原图一起删掉。备份文件由人工定期到 `doupu-backup/` 下清理。
- [ ] 创建子账号 API 密钥（仅授予该桶读写），填入 `.env`（`COS_*` 变量）。应用启动时校验 `COS_BUCKET` 与凭证齐全，缺失拒绝启动。
- [ ] 可选：若想把原图放到另一个私有桶或另一个子账号，再建一个同样不设自动删除的私有桶，填 `.env` 的 `COS_ORIGINALS_BUCKET`（及按需 `COS_ORIGINALS_SECRET_ID/KEY/REGION`）；留空即与备份共用。
- [ ] 上线后验证：用测试账号投稿一次并上传原图，控制台能看到 `originals/<修订ID>/<sha256>.<ext>` 对象；撤回作品后对象消失。

## 第 6b 步：评论内容安全（腾讯云文本内容安全，D50）

- [ ] 开通「内容安全 → 文本内容安全」，在「策略管理」创建或选用策略，记录策略编号（`BizType`）；开通前评论全部进入人工待审。
- [ ] 购买资源包或确认按量计费；应用侧成本护栏：每天最多 `TMS_DAILY_BUDGET` 次调用（默认 2000），同文 7 天缓存不重复计费，超预算评论自动转人工。
- [ ] 子账号授予 `tms:TextModeration` 权限；默认沿用 SES 的 `SES_SECRET_ID/KEY`，也可单独配置 `TMS_SECRET_ID/KEY`；把策略编号填入 `TMS_BIZ_TYPE`。
- [ ] 上线后到「管理后台 → 系统信息 → 评论内容安全服务」确认状态为「运行正常」，并用一条明显广告文案验证会被拦截且进入「评论处理」队列。

## 第 7 步：部署

- [ ] SSH 登录服务器，安装 Docker 与 docker compose 插件（OpenCloudOS：`sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin`，仓库见 docker-ce 官方源/腾讯云镜像；Ubuntu：`apt install docker.io docker-compose-v2`），将当前用户加入 docker 组。
- [ ] 将仓库中的部署编排文件同步到 `/opt/doupu`，并 `chmod +x deploy/scripts/*.sh`；应用源码不会在服务器构建。
- [ ] 复制 `.env.example` 为 `.env`，填写全部变量；`APP_IMAGE` 必须指向 release workflow 推送的稳定 GHCR tag 或 digest（禁止 `latest`）。
- [ ] 执行 `bash deploy/scripts/deploy.sh`（拉取已门禁应用镜像 → 在线只读预检 → 短暂停止 Caddy → 再次只读终检；全新空库直接放行，终检失败自动恢复原入口 → 运行数据库迁移 → 替换 app 并恢复 caddy/backup）。
- [ ] 验证：`docker compose ps` 中 app/postgres 为 healthy、caddy 为 running；backup 在首次校验备份完成前可为 starting，成功后必须为 healthy；backup 若重试耗尽后为 exited(non-zero)，按容器日志修复备份或告警链路；`curl -I https://<域名>` 返回 200。

## 发版升级（上线后的日常更新）

部署就绪后，日常发版按以下门禁流程执行：

- 推送稳定版本 tag，等待 release workflow 全绿；同步部署编排文件，在 `.env` 更新 `APP_IMAGE=ghcr.io/527520/doupu:vX.Y.Z`，再执行 `bash deploy/scripts/deploy.sh`。
- 注意：同步编排文件时**不要覆盖**服务器 `.env`（SES/COS/SMTP/TMS 等配置保留）；数据库迁移随 deploy.sh 幂等执行。
- 本轮（迁移 0013–0015）起原图默认写入备份桶 `COS_BUCKET` 的 `originals/` 前缀，`.env` 无需新增变量；升级前到控制台把该桶已有的「30 天自动删除」生命周期规则删掉（备份改为人工定期清理），确认桶上不再有任何过期规则。若 `COS_*` 不齐全，新镜像启动校验失败并自动回滚到旧入口。

## 第 8 步：上线验收（对照 spec §10）

- [ ] HTTPS 正常、无证书告警；HTTP 自动跳转 HTTPS。
- [ ] 注册 → 收到验证邮件 → 验证 → 登录 全流程可用（若收不到：检查 SES 控制台发信状态与 SPF/DKIM 验证）。
- [ ] 上传照片 → 生成图纸 → 导出 PNG/PDF/项目文件 全流程可用（用手机与桌面各测一次）。
- [ ] 先提交完整候选版本并记录 commit SHA；在物理 iPhone Safari 与 Android Chrome 完成 `deploy/evidence/mobile/README.md` 的完整矩阵。
- [ ] 按 `deploy/evidence/algorithm/README.md` 对上一版本与该候选 commit 做六类固定素材人工并排验收。
- [ ] 创建单父 attestation commit：相对候选父提交只新增当版本 mobile/algorithm 两份 JSON，二者的 `candidateCommit` 均填父提交 SHA；先将该 attestation commit 合入并推送到受保护的 `main`，再让 tag 指向它，否则 release workflow 拒绝发布镜像。
- [ ] 双设备同步：修改设计后在另一设备登录可见。
- [ ] 备份验证：手动触发一次备份脚本，从 COS 下载 dump 并确认可恢复（`deploy/restore.md` 演练）。
- [ ] 页脚不显示 ICP 占位号，开源链接与隐私政策页可访问。

## 应急速查

- 服务器失联：腾讯云控制台 VNC 登录排查；数据以每日 COS 备份为准。
- 证书续期失败：检查 80 端口可达性与 DNS；Caddy 日志 `docker compose logs caddy`。
- 邮件进垃圾箱：核对 SPF/DKIM 记录、发信域名验证状态、模板文案（避免纯链接）。
