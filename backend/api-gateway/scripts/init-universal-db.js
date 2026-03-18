#!/usr/bin/env node

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const { env } = require('../src/config/env');

function extractUniversalSql(fullSql) {
  const marker = '-- PART 2:';
  const idx = fullSql.indexOf(marker);
  if (idx === -1) {
    throw new Error('Could not locate "-- PART 2:" marker in init.sql');
  }
  return fullSql.slice(0, idx);
}

async function main() {
  const sqlPath = path.join(__dirname, '..', 'init.sql');
  const fullSql = fs.readFileSync(sqlPath, 'utf8');
  const universalSql = extractUniversalSql(fullSql);

  const client = new Client({ connectionString: env.UNIVERSAL_DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(universalSql);
    await client.query('COMMIT');
    console.log('Universal DB initialized successfully');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    console.error('Universal DB init failed:', err?.message || err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
