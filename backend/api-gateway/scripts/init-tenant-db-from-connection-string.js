#!/usr/bin/env node

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

function extractTenantSql(fullSql) {
  const part2Marker = '-- PART 2:';
  const seedMarker = '-- SAMPLE SEED DATA';

  const startIdx = fullSql.indexOf(part2Marker);
  if (startIdx === -1) throw new Error('Could not locate "-- PART 2:" marker in init.sql');

  const endIdx = fullSql.indexOf(seedMarker, startIdx);
  if (endIdx === -1) throw new Error('Could not locate "-- SAMPLE SEED DATA" marker in init.sql');

  return fullSql.slice(startIdx, endIdx);
}

async function main() {
  const connectionString = String(process.env.TENANT_DB_CONNECTION_STRING || '').trim();
  if (!connectionString) {
    throw new Error('Missing TENANT_DB_CONNECTION_STRING. Set it to the tenant DB Postgres connection string you want to initialize.');
  }

  const sqlPath = path.join(__dirname, '..', 'init.sql');
  const fullSql = fs.readFileSync(sqlPath, 'utf8');
  const tenantSql = extractTenantSql(fullSql);

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(tenantSql);
    await client.query('COMMIT');
    console.log('Tenant DB initialized successfully (PART 2 applied)');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    console.error('Tenant DB init failed:', err?.message || err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exitCode = 1;
});
