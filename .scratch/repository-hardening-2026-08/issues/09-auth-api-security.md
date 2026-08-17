# 09 认证事务、Argon2 闸门与统一 API 错误

Status: ready-for-human

Blocked by: 01

## Outcome

令牌消费、密码更新、会话撤销是原子状态转移；会话有 30 日滚动和 90 日绝对上限；Argon2/邮件/API 滥用受控；异常均为带 request ID 的统一 JSON。

## Tracer Bullet

以 reset-password 为样板：哈希事务外完成，事务内消费 token+改密+撤销会话，每个写入边界注入故障并证明完全回滚，再推广其余流程。

## Implementation

- 为 verify/reset/change/forgot 建立 transaction service；禁止 route 串联独立写入。
- sessions 增加 absoluteExpiresAt；rolling 同步更新 DB+Cookie。
- Argon2 并发 semaphore 和 route/IP/account 限流；实际发信成功后才计发送配额。
- route wrapper 捕获未知异常，裁剪 Zod issues，返回 requestId；日志关联但不泄密。
- production adapter 配置 fail-fast；dev/test 显式 fake mail/backup/alert。

## Acceptance Tests

- 每个写入边界 fault injection 后 DB 安全不变量保持。
- PostgreSQL 16 并发双消费只一方成功。
- 30/90 天边界、Cookie 与 DB 一致；Argon2 峰值并发受限。
- DB/hash/mail 异常均返回有限 JSON+requestId，无内部信息。

## Files

auth services/routes、db models/schema、http wrapper、rateLimit/mail/config、tests
