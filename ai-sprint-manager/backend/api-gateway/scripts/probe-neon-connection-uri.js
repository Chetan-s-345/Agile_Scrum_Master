#!/usr/bin/env node

require('dotenv').config();

const axios = require('axios');
const { URL } = require('url');
const { env } = require('../src/config/env');

function parsePg(urlStr) {
  const u = new URL(urlStr);
  return {
    user: decodeURIComponent(u.username || ''),
    db: (u.pathname || '').replace(/^\//, ''),
  };
}

async function tryGet(client, path) {
  try {
    const resp = await client.get(path);
    return { ok: true, status: resp.status, data: resp.data };
  } catch (e) {
    const status = e?.response?.status;
    const data = e?.response?.data;
    return { ok: false, status, data };
  }
}

async function main() {
  const base = env.UNIVERSAL_DATABASE_URL;
  const { user, db } = parsePg(base);

  const client = axios.create({
    baseURL: 'https://console.neon.tech/api/v2',
    headers: {
      Authorization: `Bearer ${env.NEON_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  const projectId = env.NEON_PROJECT_ID;
  const branchId = env.NEON_BASE_BRANCH_ID;

  // Endpoint id is not directly known here; we will try with branchId and later with explicit endpoint id.
  const candidates = [
    `/projects/${projectId}/connection_uri?branch_id=${encodeURIComponent(branchId)}`,
    `/projects/${projectId}/connection_uri?branch_id=${encodeURIComponent(branchId)}&database_name=${encodeURIComponent(db)}&role_name=${encodeURIComponent(user)}`,
    `/projects/${projectId}/connection_uri?branch_id=${encodeURIComponent(branchId)}&database=${encodeURIComponent(db)}&role=${encodeURIComponent(user)}`,
    `/projects/${projectId}/connection_uri?branch_id=${encodeURIComponent(branchId)}&database=${encodeURIComponent(db)}&role_name=${encodeURIComponent(user)}`,
    `/projects/${projectId}/connection_uri?branch_id=${encodeURIComponent(branchId)}&database_name=${encodeURIComponent(db)}&role=${encodeURIComponent(user)}`,
  ];

  for (const path of candidates) {
    const res = await tryGet(client, path);
    const keys = res?.data && typeof res.data === 'object' ? Object.keys(res.data) : null;
    console.log(JSON.stringify({ path, ok: res.ok, status: res.status, keys }, null, 0));
    if (res.ok) {
      // Don't print full connection string. Just show field names to wire parsing.
      console.log('sample.data', JSON.stringify(res.data, null, 2).slice(0, 400));
      break;
    }
  }
}

main().catch((e) => {
  console.error(e?.stack || e?.message || e);
  process.exitCode = 1;
});
