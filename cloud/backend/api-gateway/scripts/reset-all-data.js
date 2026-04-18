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

async function seedDefaultPlans(client) {
  await client.query(
    `INSERT INTO plans (name, slug, price_monthly, price_yearly, max_members, max_projects, max_sprints_per_mo, max_storage_gb, ai_requests_per_day, features, is_active)
     VALUES
      ('Free',       'free',       0.00,   0.00,    5,   2,   4,   2,   50,   '{"auto_assign":false,"burnout_detect":false,"ai_reporter":false,"skill_gap":false}'::jsonb, TRUE),
      ('Starter',    'starter',   29.00, 290.00,   15,  10,  20,  10,  500,   '{"auto_assign":true,"burnout_detect":false,"ai_reporter":true,"skill_gap":false}'::jsonb, TRUE),
      ('Pro',        'pro',       79.00, 790.00,   50,  50, 100,  50, 2000,   '{"auto_assign":true,"burnout_detect":true,"ai_reporter":true,"skill_gap":true}'::jsonb, TRUE),
      ('Enterprise', 'enterprise', 0.00,   0.00, 9999,9999,9999,500,99999,   '{"auto_assign":true,"burnout_detect":true,"ai_reporter":true,"skill_gap":true,"custom_domain":true,"sso":true,"audit_log":true}'::jsonb, TRUE)
     ON CONFLICT (slug) DO UPDATE
     SET name = EXCLUDED.name,
         price_monthly = EXCLUDED.price_monthly,
         price_yearly = EXCLUDED.price_yearly,
         max_members = EXCLUDED.max_members,
         max_projects = EXCLUDED.max_projects,
         max_sprints_per_mo = EXCLUDED.max_sprints_per_mo,
         max_storage_gb = EXCLUDED.max_storage_gb,
         ai_requests_per_day = EXCLUDED.ai_requests_per_day,
         features = EXCLUDED.features,
         is_active = TRUE,
         updated_at = NOW()`
  );
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
    await seedDefaultPlans(client);
  });

  console.log(`Reset complete. Cleared universal DB and ${tenantCount} tenant DB(s).`);
}

main().catch((err) => {
  console.error('reset-all-data failed:', err?.message || err);
  process.exit(1);
});
