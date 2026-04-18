#!/usr/bin/env node

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

function extractSqlSections(fullSql) {
  const part2Marker = '-- PART 2:';
  const seedMarker = '-- SAMPLE SEED DATA';

  const part2Idx = fullSql.indexOf(part2Marker);
  if (part2Idx === -1) {
    throw new Error('Could not locate "-- PART 2:" marker in init.sql');
  }

  const seedIdx = fullSql.indexOf(seedMarker, part2Idx);
  if (seedIdx === -1) {
    throw new Error('Could not locate "-- SAMPLE SEED DATA" marker in init.sql');
  }

  return {
    universalSql: fullSql.slice(0, part2Idx),
    tenantSql: fullSql.slice(part2Idx, seedIdx),
  };
}

async function runSql(connectionString, sql, label, useSsl = false) {
  const client = new Client(
    useSsl
      ? {
          connectionString,
          ssl: { rejectUnauthorized: false },
        }
      : { connectionString }
  );

  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log(`${label}: success`);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    throw new Error(`${label}: failed - ${err?.message || err}`);
  } finally {
    await client.end();
  }
}

async function main() {
  const universalConnectionString = String(process.env.UNIVERSAL_DATABASE_URL || '').trim();
  const tenantConnectionString = String(process.env.TENANT_DB_CONNECTION_STRING || '').trim();

  if (!universalConnectionString) {
    throw new Error('Missing UNIVERSAL_DATABASE_URL. Set it before running init:contributor-db.');
  }

  const sqlPath = path.join(__dirname, '..', 'init.sql');
  const fullSql = fs.readFileSync(sqlPath, 'utf8');
  const { universalSql, tenantSql } = extractSqlSections(fullSql);

  console.log('Initializing universal schema...');
  await runSql(universalConnectionString, universalSql, 'Universal DB');

  if (tenantConnectionString) {
    console.log('Initializing tenant schema (TENANT_DB_CONNECTION_STRING detected)...');
    await runSql(tenantConnectionString, tenantSql, 'Tenant DB', true);
  } else {
    console.log('Skipping tenant schema (TENANT_DB_CONNECTION_STRING is not set).');
    console.log('Set TENANT_DB_CONNECTION_STRING and re-run this script to initialize a tenant DB.');
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exitCode = 1;
});
