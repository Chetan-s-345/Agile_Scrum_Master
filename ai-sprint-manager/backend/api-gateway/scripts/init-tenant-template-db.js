#!/usr/bin/env node

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const { env } = require('../src/config/env');
const { NeonBranchManager } = require('../src/config/neon');

function extractTenantTemplateSql(fullSql) {
  const part2Marker = '-- PART 2:';
  const seedMarker = '-- SAMPLE SEED DATA';

  const startIdx = fullSql.indexOf(part2Marker);
  if (startIdx === -1) {
    throw new Error('Could not locate "-- PART 2:" marker in init.sql');
  }

  const endIdx = fullSql.indexOf(seedMarker, startIdx);
  if (endIdx === -1) {
    throw new Error('Could not locate "-- SAMPLE SEED DATA" marker in init.sql');
  }

  return fullSql.slice(startIdx, endIdx);
}

async function main() {
  const sqlPath = path.join(__dirname, '..', 'init.sql');
  const fullSql = fs.readFileSync(sqlPath, 'utf8');
  const tenantSql = extractTenantTemplateSql(fullSql);

  const neon = new NeonBranchManager();
  const connectionString = await neon.getBranchConnectionString(env.NEON_BASE_BRANCH_ID);

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(tenantSql);
    await client.query('COMMIT');
    console.log('Tenant template DB initialized successfully (base branch)');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    console.error('Tenant template DB init failed:', err?.message || err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
