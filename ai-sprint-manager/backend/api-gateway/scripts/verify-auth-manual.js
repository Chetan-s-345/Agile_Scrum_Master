#!/usr/bin/env node

require('dotenv').config();

const { Client } = require('pg');

const { env } = require('../src/config/env');
const { NeonBranchManager } = require('../src/config/neon');

async function readText(resp) {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}

async function assertGatewayUp(baseUrl) {
  const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`);
  if (!resp.ok) {
    const text = await readText(resp);
    throw new Error(`Gateway not healthy: HTTP ${resp.status} ${text}`);
  }
}

async function getTenantConnString() {
  // Explicit override wins.
  const direct = String(process.env.TENANT_DB_CONNECTION_STRING || '').trim();
  if (direct) return direct;

  // In manual mode, allow using the configured Neon base branch as a known-good tenant DB for verification.
  // This is ONLY for verification — in real usage, each org should provide a distinct tenant DB connection string.
  if (env.TENANT_DB_PROVISIONING_MODE === 'manual' && env.NEON_BASE_BRANCH_ID) {
    const neon = new NeonBranchManager();
    return await neon.getBranchConnectionString(env.NEON_BASE_BRANCH_ID);
  }

  return null;
}

async function checkTenantSchema(connectionString) {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const resp = await client.query(
      "SELECT to_regclass('public.org_settings') AS org_settings, to_regclass('public.team_members') AS team_members"
    );
    return resp.rows[0] || {};
  } finally {
    await client.end();
  }
}

async function main() {
  const gatewayBaseUrl = String(process.env.GATEWAY_URL || 'http://localhost:4000');
  await assertGatewayUp(gatewayBaseUrl);

  const tenantDbConnectionString = await getTenantConnString();
  if (!tenantDbConnectionString) {
    throw new Error(
      'Missing tenant DB connection string. Set TENANT_DB_CONNECTION_STRING, or (for manual mode verification) set NEON_* and NEON_BASE_BRANCH_ID.'
    );
  }

  const schema = await checkTenantSchema(tenantDbConnectionString);
  console.log('Tenant schema check:', schema);

  const email = `verify+${Date.now()}@example.com`;
  const password = 'Passw0rd!123';
  const orgSlug = `verifyorg${Math.floor(Math.random() * 10000)}`;

  const registerPayload = {
    fullName: 'Verify User',
    email,
    password,
    orgName: 'Verify Org',
    orgSlug,
    planSlug: 'free',
    tenantDbConnectionString,
  };

  const registerResp = await fetch(`${gatewayBaseUrl.replace(/\/+$/, '')}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registerPayload),
  });

  console.log('REGISTER STATUS:', registerResp.status);
  console.log(await readText(registerResp));

  const schemaAfter = await checkTenantSchema(tenantDbConnectionString);
  console.log('Tenant schema check (after register):', schemaAfter);

  const loginPayload = { email, password, orgSlug };
  const loginResp = await fetch(`${gatewayBaseUrl.replace(/\/+$/, '')}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(loginPayload),
  });

  console.log('LOGIN STATUS:', loginResp.status);
  console.log(await readText(loginResp));

  if (!registerResp.ok || !loginResp.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exitCode = 1;
});
