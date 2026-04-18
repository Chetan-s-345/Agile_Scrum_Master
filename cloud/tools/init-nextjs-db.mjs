#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "@neondatabase/serverless";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";

  let inSingle = false;
  let inDouble = false;
  let dollarTag = null;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next2 = sql.slice(i, i + 2);

    // Line comments
    if (!inSingle && !inDouble && !dollarTag && next2 === "--") {
      // consume until end of line
      const nl = sql.indexOf("\n", i + 2);
      if (nl === -1) break;
      current += sql.slice(i, nl + 1);
      i = nl;
      continue;
    }

    // Block comments
    if (!inSingle && !inDouble && !dollarTag && next2 === "/*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) {
        // unterminated comment; treat rest as comment
        break;
      }
      current += sql.slice(i, end + 2);
      i = end + 1;
      continue;
    }

    // Dollar-quoted strings: $tag$...$tag$
    if (!inSingle && !inDouble) {
      if (!dollarTag && ch === "$") {
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
      // Handle escaped '' within single quotes
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

    if (!inSingle && !inDouble && !dollarTag && ch === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.join(__dirname, "..");
  loadEnvFile(path.join(repoRoot, ".env"));
  loadEnvFile(path.join(repoRoot, ".env.local"));

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    console.error("Missing DATABASE_URL. Set it to your Neon Postgres connection string.");
    process.exitCode = 1;
    return;
  }
  const sqlPath = path.join(__dirname, "..", "database", "init.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  const statements = splitSqlStatements(sql)
    // Ignore pure comments/whitespace
    .map((s) => s.trim())
    .filter(Boolean);

  const pool = new Pool({ connectionString: databaseUrl });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const stmt of statements) {
      await client.query(stmt);
    }
    await client.query("COMMIT");
    console.log("Next.js app DB initialized successfully (database/init.sql applied)");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    console.error("Next.js app DB init failed:", err?.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
