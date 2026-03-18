require('dotenv').config();

const { Client } = require('pg');

function normalizeConnectionString(value) {
  const v = String(value || '').trim();
  return v || null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((v) => String(v)))];
}

async function withClient(connectionString, fn) {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function truncateAllPublicTables(client) {
  const tablesResp = await client.query(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename`
  );

  const tableNames = tablesResp.rows.map((r) => r.tablename).filter(Boolean);
  if (!tableNames.length) return { truncated: 0 };

  const quoted = tableNames.map((name) => `"public"."${String(name).replace(/"/g, '""')}"`).join(', ');
  // Data-only reset: keep all tables/structure, remove rows, reset identities.
  await client.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  return { truncated: tableNames.length };
}

async function getTenantConnections(universalConnectionString) {
  return withClient(universalConnectionString, async (client) => {
    const columnsResp = await client.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'organizations'`
    );
    const hasConn = columnsResp.rows.some((r) => r.column_name === 'db_connection_string');
    if (!hasConn) return [];

    const orgsResp = await client.query(
      `SELECT db_connection_string
       FROM organizations
       WHERE db_connection_string IS NOT NULL
         AND btrim(db_connection_string) <> ''`
    );

    return unique(orgsResp.rows.map((r) => normalizeConnectionString(r.db_connection_string)));
  });
}

async function main() {
  const confirmed = process.argv.includes('--yes');
  if (!confirmed) {
    console.error('Refusing to run destructive reset without --yes flag.');
    console.error('Usage: node scripts/reset-all-data.js --yes');
    process.exit(1);
  }

  const universalConnectionString = normalizeConnectionString(process.env.UNIVERSAL_DATABASE_URL);
  if (!universalConnectionString) {
    throw new Error('Missing UNIVERSAL_DATABASE_URL.');
  }

  const tenantConnections = await getTenantConnections(universalConnectionString);

  let tenantCount = 0;
  for (const conn of tenantConnections) {
    await withClient(conn, async (client) => {
      await truncateAllPublicTables(client);
    });
    tenantCount += 1;
  }

  await withClient(universalConnectionString, async (client) => {
    await truncateAllPublicTables(client);
  });

  console.log(`Reset complete. Cleared universal DB and ${tenantCount} tenant DB(s).`);
}

main().catch((err) => {
  console.error('reset-all-data failed:', err?.message || err);
  process.exit(1);
});
