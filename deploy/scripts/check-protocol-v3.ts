#!/usr/bin/env node
/**
 * ProjectFile/ShareSnapshot v3 协调切换的只读发布检查。
 *
 * 协议校验直接复用应用正式 schema；构建阶段将本文件与正式校验依赖打成一个
 * CommonJS 产物，运行镜像只负责查询数据库与报告问题，不维护第二套协议实现。
 */
import { Pool } from 'pg';
import { projectFileSchema } from '@/lib/schemas';
import { parseShareSnapshot } from '@/lib/share/snapshot';

export interface ProtocolRows {
  designs: Array<{ id: string; project: unknown }>;
  shares: Array<{ id: string; snapshot: unknown }>;
}

export interface ProtocolIssue {
  kind: 'design' | 'share';
  id: string;
  reason: 'not strict ProjectFile v3' | 'not strict ShareSnapshot v3';
}

export interface ProtocolDatabaseInspection {
  issues: ProtocolIssue[];
  designCount: number;
  shareCount: number;
}

export interface ProtocolReadClient {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** 检查已经从数据库解码的行；纯函数，供发布门禁与单元测试共用。 */
export function inspectProtocolRows({ designs, shares }: ProtocolRows): ProtocolIssue[] {
  const issues: ProtocolIssue[] = [];
  for (const row of designs) {
    if (!projectFileSchema.safeParse(row.project).success) {
      issues.push({ kind: 'design', id: row.id, reason: 'not strict ProjectFile v3' });
    }
  }
  for (const row of shares) {
    if (parseShareSnapshot(row.snapshot) === null) {
      issues.push({ kind: 'share', id: row.id, reason: 'not strict ShareSnapshot v3' });
    }
  }
  return issues;
}

/**
 * 在迁移前只读检查当前已存在的协议表。全新空库没有历史数据，可继续由迁移创建表；
 * 只要某张表已经存在，就必须严格检查其中的活动记录。
 */
export async function inspectProtocolDatabase(
  client: ProtocolReadClient,
): Promise<ProtocolDatabaseInspection> {
  const tableResult = await client.query(`
    SELECT
      to_regclass('public.designs') IS NOT NULL AS designs_exists,
      to_regclass('public.design_shares') IS NOT NULL AS shares_exists
  `);
  const tableStatus = tableResult.rows[0];
  const designs = tableStatus?.designs_exists === true
    ? (await client.query('SELECT id, project FROM designs WHERE deleted_at IS NULL ORDER BY id')).rows
      .map((row) => ({ id: String(row.id), project: row.project }))
    : [];
  const shares = tableStatus?.shares_exists === true
    ? (await client.query('SELECT id, snapshot FROM design_shares ORDER BY id')).rows
      .map((row) => ({ id: String(row.id), snapshot: row.snapshot }))
    : [];

  return {
    issues: inspectProtocolRows({ designs, shares }),
    designCount: designs.length,
    shareCount: shares.length,
  };
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('缺少 DATABASE_URL');

  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    transactionStarted = true;
    const inspection = await inspectProtocolDatabase({
      query: async (sql) => {
        const result = await client.query(sql);
        return { rows: result.rows };
      },
    });
    const { issues } = inspection;
    if (issues.length > 0) {
      for (const issue of issues) {
        const kind = issue.kind === 'design' ? '设计' : '分享';
        const reason = issue.kind === 'design' ? '不是严格 ProjectFile v3' : '不是严格 ShareSnapshot v3';
        console.error(`${kind} ${issue.id}: ${reason}`);
      }
      process.exitCode = 1;
      return;
    }
    console.log(
      `协议 v3 只读检查通过：${inspection.designCount} 条活动设计，${inspection.shareCount} 条分享`,
    );
  } finally {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
