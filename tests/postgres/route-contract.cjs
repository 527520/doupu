/**
 * PostgreSQL 16 route contract.
 *
 * Runs against the already-started standalone app in CI. Mutations go through
 * the real HTTP routes and production node-postgres adapter. Direct SQL is
 * limited to identifying the seeded user, establishing an impractical
 * near-50 MiB quota fixture, verifying persisted invariants, and cleanup.
 */
const { createHash, randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { strictV3Project: project } = require('./protocol-fixtures.cjs');

const connectionString = process.env.DATABASE_URL;
const baseUrl = process.env.E2E_BASE_URL;
const sessionToken = process.env.E2E_SESSION_TOKEN;
if (!connectionString || !baseUrl || !sessionToken) {
  throw new Error('DATABASE_URL, E2E_BASE_URL and E2E_SESSION_TOKEN are required');
}

const pool = new Pool({ connectionString, max: 4 });
const createdIds = new Set();
const createdPaletteIds = new Set();
const cookie = `doupu_session=${sessionToken}`;
const DESIGN_BYTES_PER_USER = 50 * 1024 * 1024;

async function request(method, path, data) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      cookie,
      ...(data === undefined ? {} : { 'content-type': 'application/json', origin: baseUrl }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

function expect(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details === undefined ? '' : `: ${JSON.stringify(details)}`}`);
  }
}

function expectStatus(result, status, label) {
  expect(result.status === status, `${label} returned ${result.status}, expected ${status}`, result.body);
}

async function putDesign(id, name, baseRevision) {
  createdIds.add(id);
  return request('PUT', `/api/designs/${id}`, {
    name,
    project: project(name),
    baseRevision,
  });
}

async function deleteDesign(id, baseRevision) {
  return request('DELETE', `/api/designs/${id}`, { baseRevision });
}

async function cleanupDesignFixtures(userId, ids) {
  await pool.query(
    'DELETE FROM designs WHERE user_id = $1 AND id = ANY($2::uuid[])',
    [userId, ids],
  );
  for (const id of ids) createdIds.delete(id);
}

async function listEveryPage(path) {
  const items = [];
  const cursors = new Set();
  let cursor = null;
  let pages = 0;
  do {
    const pagePath = cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;
    const page = await request('GET', pagePath);
    expectStatus(page, 200, `${path} cursor page ${pages + 1}`);
    expect(Array.isArray(page.body?.items), `${path} cursor page has no items array`, page.body);
    items.push(...page.body.items);
    pages += 1;
    cursor = page.body.nextCursor;
    if (cursor) {
      expect(!cursors.has(cursor), `${path} cursor repeated`, cursor);
      cursors.add(cursor);
    }
  } while (cursor);
  return { items, pages };
}

function paletteColors(seed) {
  return [
    { code: `${seed}-A`, hex: '#112233' },
    { code: `${seed}-B`, hex: '#DDEEFF' },
  ];
}

async function putPalette(id, name, baseRevision) {
  createdPaletteIds.add(id);
  return request('PUT', `/api/palettes/${id}`, {
    name,
    colors: paletteColors(name),
    baseRevision,
  });
}

async function main() {
  const tokenHash = createHash('sha256').update(sessionToken).digest('hex');
  const session = await pool.query('SELECT user_id FROM sessions WHERE token_hash = $1', [tokenHash]);
  expect(session.rowCount === 1, 'seeded production session was not found');
  const userId = session.rows[0].user_id;

  try {
    const casId = randomUUID();
    expectStatus(await putDesign(casId, 'cas-v1', 0), 200, 'initial CAS create');
    const casWrites = await Promise.all([
      putDesign(casId, 'cas-winner-a', 1),
      putDesign(casId, 'cas-winner-b', 1),
    ]);
    expect(
      casWrites.map((result) => result.status).sort((a, b) => a - b).join(',') === '200,409',
      'route CAS did not produce exactly one winner',
      casWrites,
    );
    const conflict = casWrites.find((result) => result.status === 409);
    expect(conflict?.body?.error?.code === 'REVISION_CONFLICT', 'CAS conflict lost REVISION_CONFLICT classification', conflict);
    const stored = await request('GET', `/api/designs/${casId}`);
    expectStatus(stored, 200, 'read CAS winner');
    expect(stored.body.revision === 2, 'CAS winner revision was not persisted', stored.body);

    const paletteId = randomUUID();
    expectStatus(await putPalette(paletteId, 'palette-v1', 0), 200, 'initial palette CAS create');
    const paletteWrites = await Promise.all([
      putPalette(paletteId, 'palette-winner-a', 1),
      putPalette(paletteId, 'palette-winner-b', 1),
    ]);
    expect(
      paletteWrites.map((result) => result.status).sort((a, b) => a - b).join(',') === '200,409',
      'palette route CAS did not produce exactly one winner',
      paletteWrites,
    );
    const paletteConflict = paletteWrites.find((result) => result.status === 409);
    expect(
      paletteConflict?.body?.error?.code === 'REVISION_CONFLICT',
      'palette CAS conflict lost REVISION_CONFLICT classification',
      paletteConflict,
    );
    const storedPalette = await request('GET', `/api/palettes/${paletteId}`);
    expectStatus(storedPalette, 200, 'read palette CAS winner');
    expect(storedPalette.body.revision === 2, 'palette CAS winner revision was not persisted', storedPalette.body);

    const deleted = await deleteDesign(casId, 2);
    expectStatus(deleted, 200, 'tombstone delete');
    expect(deleted.body.revision === 3, 'tombstone revision did not advance', deleted.body);
    const repeatedDelete = await deleteDesign(casId, 2);
    expectStatus(repeatedDelete, 200, 'idempotent tombstone delete');
    expectStatus(await request('GET', `/api/designs/${casId}`), 404, 'tombstoned design read');
    const listed = await request('GET', '/api/designs');
    expectStatus(listed, 200, 'tombstone list');
    expect(
      listed.body.items.some((item) => item.id === casId && item.deleted === true && item.revision === 3),
      'tombstone was not visible to the sync list route',
      listed.body,
    );
    const compact = await pool.query(
      'SELECT name, project, payload_bytes, deleted_at FROM designs WHERE id = $1 AND user_id = $2',
      [casId, userId],
    );
    expect(compact.rowCount === 1, 'tombstone row disappeared before retention');
    expect(
      compact.rows[0].name === ''
        && compact.rows[0].project === null
        && compact.rows[0].payload_bytes === 0
        && compact.rows[0].deleted_at !== null,
      'tombstone retained payload',
      compact.rows[0],
    );

    // Measure through the real Route first; direct SQL only establishes the
    // otherwise impractical near-50 MiB quota precondition.
    const byteProbeId = randomUUID();
    expectStatus(await putDesign(byteProbeId, 'byte-candidate', 0), 200, 'byte quota payload probe');
    const byteProbe = await pool.query(
      'SELECT payload_bytes FROM designs WHERE id = $1 AND user_id = $2',
      [byteProbeId, userId],
    );
    expect(byteProbe.rowCount === 1 && byteProbe.rows[0].payload_bytes > 0, 'byte quota probe was not persisted');
    const candidateBytes = byteProbe.rows[0].payload_bytes;
    await cleanupDesignFixtures(userId, [byteProbeId]);

    const byteSeedId = randomUUID();
    const byteCandidateIds = [randomUUID(), randomUUID()];
    const byteFixtureIds = [byteSeedId, ...byteCandidateIds];
    for (const id of byteFixtureIds) createdIds.add(id);
    await pool.query(
      `INSERT INTO designs(id,user_id,name,project,revision,payload_bytes,updated_at)
       VALUES ($1,$2,$3,$4::jsonb,1,$5,now())`,
      [
        byteSeedId,
        userId,
        'byte-quota-seed',
        JSON.stringify(project('byte-quota-seed')),
        DESIGN_BYTES_PER_USER - Math.floor(candidateBytes * 1.5),
      ],
    );
    const byteWrites = await Promise.all(
      byteCandidateIds.map((id) => putDesign(id, 'byte-candidate', 0)),
    );
    const byteAccepted = byteWrites.filter((result) => result.status === 200);
    const byteRejected = byteWrites.filter((result) => result.status === 409);
    expect(
      byteAccepted.length === 1 && byteRejected.length === 1,
      'design byte quota race did not produce exactly one winner',
      byteWrites,
    );
    expect(
      byteRejected[0].body?.error?.code === 'CONFLICT',
      'design byte quota conflict lost CONFLICT classification',
      byteRejected[0],
    );
    const byteUsage = await pool.query(
      'SELECT coalesce(sum(payload_bytes),0)::bigint AS bytes FROM designs WHERE user_id = $1',
      [userId],
    );
    expect(
      Number(byteUsage.rows[0].bytes) <= DESIGN_BYTES_PER_USER,
      'design byte quota was exceeded',
      byteUsage.rows[0],
    );
    await cleanupDesignFixtures(userId, byteFixtureIds);

    // Deterministic lost-response retry: the first response is intentionally
    // ignored. A retry with the original baseRevision must be recoverable by
    // reading the single committed row, not treated as a second write.
    const retryId = randomUUID();
    await putDesign(retryId, 'lost-response-design', 0);
    const retry = await putDesign(retryId, 'lost-response-design', 0);
    const recovered = await request('GET', `/api/designs/${retryId}`);
    expect(
      retry.status === 409
        && retry.body?.error?.code === 'REVISION_CONFLICT'
        && recovered.status === 200
        && recovered.body?.revision === 1
        && recovered.body?.name === 'lost-response-design',
      'lost-response retry was not classified as an already-committed write',
      { retry, recovered },
    );
    const retryRows = await pool.query(
      'SELECT count(*)::int AS count FROM designs WHERE id = $1 AND user_id = $2',
      [retryId, userId],
    );
    expect(retryRows.rows[0].count === 1, 'lost-response retry created duplicate rows', retryRows.rows[0]);
    await cleanupDesignFixtures(userId, [retryId]);

    const quotaIds = Array.from({ length: 101 }, () => randomUUID());
    const quotaWrites = await Promise.all(
      quotaIds.map((id, index) => putDesign(id, `quota-${index}`, 0)),
    );
    const accepted = quotaWrites
      .map((result, index) => ({ result, id: quotaIds[index] }))
      .filter(({ result }) => result.status === 200);
    const rejected = quotaWrites
      .map((result, index) => ({ result, id: quotaIds[index] }))
      .filter(({ result }) => result.status === 409);
    expect(accepted.length === 100 && rejected.length === 1, 'design active quota was not serialized', {
      accepted: accepted.length,
      rejected: rejected.length,
    });
    expect(rejected[0].result.body?.error?.code === 'CONFLICT', 'design active quota lost CONFLICT classification', rejected[0]);
    const activeAtLimit = await pool.query(
      'SELECT count(*)::int AS count FROM designs WHERE user_id = $1 AND deleted_at IS NULL',
      [userId],
    );
    expect(activeAtLimit.rows[0].count === 100, 'design active quota exceeded in PostgreSQL', activeAtLimit.rows[0]);

    const releasedId = accepted[0].id;
    expectStatus(await deleteDesign(releasedId, 1), 200, 'quota slot tombstone');
    expectStatus(await putDesign(rejected[0].id, 'quota-retry', 0), 200, 'create after tombstone released active slot');
    const activeAfterRetry = await pool.query(
      'SELECT count(*)::int AS count FROM designs WHERE user_id = $1 AND deleted_at IS NULL',
      [userId],
    );
    expect(activeAfterRetry.rows[0].count === 100, 'tombstone did not release exactly one active quota slot', activeAfterRetry.rows[0]);
    const released = await pool.query(
      'SELECT project, payload_bytes, deleted_at FROM designs WHERE id = $1 AND user_id = $2',
      [releasedId, userId],
    );
    expect(
      released.rows[0].project === null
        && released.rows[0].payload_bytes === 0
        && released.rows[0].deleted_at !== null,
      'quota tombstone retained payload',
      released.rows[0],
    );

    const paged = await listEveryPage('/api/designs');
    const pagedIds = paged.items.map((item) => item.id);
    expect(paged.pages >= 3, '100+ designs did not span at least three cursor pages', paged.pages);
    expect(new Set(pagedIds).size === pagedIds.length, 'cursor pagination returned duplicate designs', pagedIds);
    for (const id of [casId, ...quotaIds]) {
      expect(pagedIds.includes(id), 'cursor pagination missed a persisted design', id);
    }

    process.stdout.write('postgres route design/palette CAS/quota/tombstone/pagination/retry contract passed\n');
  } finally {
    if (createdIds.size > 0) {
      await pool.query(
        'DELETE FROM designs WHERE user_id = $1 AND id = ANY($2::uuid[])',
        [userId, [...createdIds]],
      );
    }
    if (createdPaletteIds.size > 0) {
      await pool.query(
        'DELETE FROM palettes WHERE user_id = $1 AND id = ANY($2::uuid[])',
        [userId, [...createdPaletteIds]],
      );
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
