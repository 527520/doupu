/**
 * Drizzle schema（与 db/migrations/0000_init.sql 一一对应；spec §5.1/§5.2）。
 * 说明：drizzle-orm 尚未安装（T13 交付时依赖缺失，父代理负责安装后执行 typecheck/test），
 * 本文件按 drizzle-orm/pg-core 稳定 API 编写。
 */
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 邮箱大小写不敏感由 lower(email) 唯一索引保证（PGlite 测试环境无 citext 扩展）
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`)],
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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type EmailToken = typeof emailTokens.$inferSelect;
export type Design = typeof designs.$inferSelect;
export type NewDesign = typeof designs.$inferInsert;
export type Palette = typeof palettes.$inferSelect;
export type RateLimit = typeof rateLimits.$inferSelect;
