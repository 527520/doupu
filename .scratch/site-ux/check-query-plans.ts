import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { listManagedCommunityWorks } from '../../src/lib/community/adminQueries';
import { listAdminAudit, getSystemInfo } from '../../src/lib/admin/queries';
import { queryAnalyticsDimensions, queryAnalyticsSummary, queryAnalyticsTrend } from '../../src/lib/analytics/reports';

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/siteux_image_preflight');
  const pool = new Pool({ connectionString: url.href, max: 1 });
  const client = await pool.connect();
  const queries: Array<{ query: string; params: unknown[] }> = [];
  const db = drizzle(client, { schema, logger: { logQuery(query, params) { queries.push({ query, params }); } } });
  try {
    await client.query('begin read only');
    await client.query("set local statement_timeout = '5s'");
    await listManagedCommunityWorks(db, {});
    await listManagedCommunityWorks(db, { status: 'active', q: 'local-test' });
    await listAdminAudit(db, {});
    await listAdminAudit(db, { q: 'official', from: '2026-09-01', to: '2026-09-05' });
    await getSystemInfo(db);
    const now = new Date('2026-09-05T04:00:00Z');
    const range = { start: '2026-05-01', end: '2026-09-05' };
    await queryAnalyticsSummary(db, range, now);
    await queryAnalyticsTrend(db, range, now);
    await queryAnalyticsDimensions(db, range, 'device', now);
    for (const [index, { query, params }] of queries.entries()) {
      assert.match(query, /^select /i);
      const explained = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`, params);
      const plan = explained.rows[0]['QUERY PLAN'][0];
      assert.equal(typeof plan['Execution Time'], 'number');
      console.log(JSON.stringify({ index: index + 1, query, plan }));
    }
    console.log(`Explained ${queries.length} actual application SELECTs on local PostgreSQL 16; small fixture data only, not a production scale benchmark.`);
  } finally { await client.query('rollback'); client.release(); await pool.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
