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

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';

  let inSingle = false;
  let inDouble = false;
  let dollarTag = null;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next2 = sql.slice(i, i + 2);

    // Line comments
    if (!inSingle && !inDouble && !dollarTag && next2 === '--') {
      const nl = sql.indexOf('\n', i + 2);
      if (nl === -1) break;
      current += sql.slice(i, nl + 1);
      i = nl;
      continue;
    }

    // Block comments
    if (!inSingle && !inDouble && !dollarTag && next2 === '/*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) break;
      current += sql.slice(i, end + 2);
      i = end + 1;
      continue;
    }

    // Dollar-quoted strings: $tag$...$tag$
    if (!inSingle && !inDouble) {
      if (!dollarTag && ch === '$') {
        const m = sql.slice(i).match(/^\$[a-zA-Z0-9_]*\$/);
        if (m) {
          dollarTag = m[0];
          current += dollarTag;
          i += dollarTag.length - 1;
          continue;
        }
      } else if (dollarTag) {
        if (sql.startsWith(dollarTag, i)) {
          current += dollarTag;
          i += dollarTag.length - 1;
          dollarTag = null;
          continue;
        }
      }
    }

    if (!dollarTag && !inDouble && ch === "'") {
      if (inSingle && sql[i + 1] === "'") {
        current += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (!dollarTag && !inSingle && ch === '"') {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (!inSingle && !inDouble && !dollarTag && ch === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function isIgnorableInitError(err) {
  const code = err?.code;
  // duplicate_table, duplicate_object, duplicate_function, duplicate_schema
  if (code === '42P07' || code === '42710' || code === '42723' || code === '42P06') return true;
  // duplicate_column
  if (code === '42701') return true;
  // unique_violation (should be rare because seeds use ON CONFLICT, but safe)
  if (code === '23505') return true;
  return false;
}

async function main() {
  const sqlPath = path.join(__dirname, '..', 'init.sql');
  const fullSql = fs.readFileSync(sqlPath, 'utf8');
  const universalSql = extractUniversalSql(fullSql);
  const statements = splitSqlStatements(universalSql)
    .map((s) => s.trim())
    .filter(Boolean);

  const client = new Client({
    connectionString: env.UNIVERSAL_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    // Run statements one-by-one so this can be safely re-run against an existing DB.
    // We intentionally do NOT wrap in a single transaction because a single "already exists" error
    // would abort the transaction and roll everything back.
    for (const stmt of statements) {
      try {
        await client.query(stmt);
      } catch (err) {
        if (isIgnorableInitError(err)) {
          // eslint-disable-next-line no-console
          console.warn('Init skip (already exists):', err?.message || err);
          continue;
        }
        throw err;
      }
    }

    // Post-check: ensure billing tables + required columns exist (common failure mode on existing DBs).
    const check = await client.query(
      "SELECT to_regclass('public.coupons') AS coupons, to_regclass('public.subscriptions') AS subscriptions, to_regclass('public.payments') AS payments"
    );
    const row = check.rows[0] || {};

    if (!row.coupons || !row.subscriptions || !row.payments) {
      throw new Error(
        'Universal DB init completed but billing tables are missing. Ensure UNIVERSAL_DATABASE_URL points to the correct database and rerun init.'
      );
    }

    const colCheck = await client.query(
      `SELECT
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' AND column_name='tenant_id') AS has_tenant_id,
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' AND column_name='final_amount') AS has_final_amount,
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='provider_transaction_id') AS has_provider_tx
       `
    );
    const cols = colCheck.rows[0] || {};
    if (!cols.has_tenant_id || !cols.has_final_amount || !cols.has_provider_tx) {
      throw new Error(
        'Universal DB init completed but billing columns are missing (e.g., subscriptions.tenant_id). Re-run init after pulling latest backend/api-gateway/init.sql migrations.'
      );
    }

    console.log('Universal DB initialized successfully');
  } catch (err) {
    console.error('Universal DB init failed:', err?.message || err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
