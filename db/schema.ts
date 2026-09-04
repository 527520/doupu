/**
 * Drizzle schema（与 db/migrations/0000_init.sql 一一对应；spec §5.1/§5.2）。
 * 说明：drizzle-orm 尚未安装（T13 交付时依赖缺失，父代理负责安装后执行 typecheck/test），
 * 本文件按 drizzle-orm/pg-core 稳定 API 编写。
 */
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const userRoleEnum = pgEnum('user_role', ['user', 'moderator', 'admin']);
export const accountStatusEnum = pgEnum('account_status', ['active', 'suspended', 'anonymized']);
export const maintenanceStatusEnum = pgEnum('maintenance_status', ['running', 'succeeded', 'failed']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 邮箱大小写不敏感由 lower(email) 唯一索引保证（PGlite 测试环境无 citext 扩展）
    email: text('email'),
    // 可选展示名：不唯一、不能用于登录；已有账号保持 null。
    username: text('username'),
    passwordHash: text('password_hash'),
    role: userRoleEnum('role').notNull().default('user'),
    accountStatus: accountStatusEnum('account_status').notNull().default('active'),
    governanceVersion: integer('governance_version').notNull().default(1),
    publicAuthorId: uuid('public_author_id'),
    accountStatusReason: text('account_status_reason'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`),
    uniqueIndex('users_public_author_unique')
      .on(table.publicAuthorId)
      .where(sql`${table.publicAuthorId} is not null`),
  ],
);

export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: userRoleEnum('actor_role').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason').notNull(),
    requestId: text('request_id').notNull(),
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('admin_audit_logs_created_idx').on(table.createdAt.desc()),
    index('admin_audit_logs_target_idx').on(table.targetType, table.targetId, table.createdAt.desc()),
  ],
);

export const maintenanceRuns = pgTable(
  'maintenance_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    task: text('task').notNull(),
    status: maintenanceStatusEnum('status').notNull().default('running'),
    cursor: text('cursor'),
    summary: jsonb('summary'),
    errorCode: text('error_code'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [index('maintenance_runs_task_started_idx').on(table.task, table.startedAt.desc())],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').unique().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '90 days'`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
);

export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: ['verify', 'reset'] }).notNull(),
    tokenHash: text('token_hash').unique().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [index('email_tokens_user_idx').on(table.userId)],
);

/** 设计文档：id 由客户端生成（spec §4.2 幂等 upsert），project 为项目文件 JSON。 */
export const designs = pgTable(
  'designs',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    project: jsonb('project'),
    revision: integer('revision').notNull().default(1),
    payloadBytes: integer('payload_bytes').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('designs_user_sync_idx').on(table.userId, table.deletedAt, table.updatedAt.desc()),
  ],
);

/** 自定义色板（云端同步，spec §F6）。 */
export const palettes = pgTable(
  'palettes',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    colors: jsonb('colors'),
    revision: integer('revision').notNull().default(1),
    payloadBytes: integer('payload_bytes').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('palettes_user_idx').on(table.userId, table.deletedAt)],
);

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * 只读分享（批次 K / 决策 D38，取代 D23 的「无公开分享页」）。
 *
 * 设计要点：
 * - 存的是**图纸快照**而不是引用当前设计：分享出去的链接不该因为作者继续编辑而变样，
 *   更不该在作者删除设计后变成 500；
 * - token 只存哈希（与会话、邮件令牌同一套做法），数据库泄露不等于分享链接泄露；
 * - 与 D13 一致：快照里只有图纸数据，没有原图，也不含作者邮箱；
 * - 作者可随时撤销（删除该行），一个设计同时最多一条有效分享。
 */
export const designShares = pgTable(
  'design_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    designId: uuid('design_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').unique().notNull(),
    /** 分享时的图纸快照（项目文件 JSON，去掉与作者相关的字段）。 */
    snapshot: jsonb('snapshot').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** 浏览计数：让作者知道链接有没有被看，不记录访客身份。 */
    viewCount: integer('view_count').notNull().default(0),
  },
  (table) => [
    uniqueIndex('design_shares_design_unique').on(table.designId),
    index('design_shares_user_idx').on(table.userId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;
export type MaintenanceRun = typeof maintenanceRuns.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type EmailToken = typeof emailTokens.$inferSelect;
export type Design = typeof designs.$inferSelect;
export type NewDesign = typeof designs.$inferInsert;
export type Palette = typeof palettes.$inferSelect;
export type RateLimit = typeof rateLimits.$inferSelect;
export type DesignShare = typeof designShares.$inferSelect;
