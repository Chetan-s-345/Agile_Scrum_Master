#!/usr/bin/env node

require('dotenv').config();

const axios = require('axios');
const { env } = require('../src/config/env');

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /(password|secret|token|uri|url|connection)/i.test(k)) {
      clone[k] = '[redacted]';
    } else if (typeof v === 'string' && /^postgres(ql)?:\/\//i.test(v)) {
      clone[k] = '[redacted]';
    } else if (v && typeof v === 'object') {
      clone[k] = redact(v);
    } else {
      clone[k] = v;
    }
  }
  return clone;
}

async function main() {
  if (!env.NEON_API_KEY || !env.NEON_PROJECT_ID || !env.NEON_BASE_BRANCH_ID) {
    throw new Error('Missing NEON_* env vars; cannot query Neon API');
  }

  const client = axios.create({
    baseURL: 'https://console.neon.tech/api/v2',
    headers: {
      Authorization: `Bearer ${env.NEON_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  const resp = await client.get(`/projects/${env.NEON_PROJECT_ID}/branches/${env.NEON_BASE_BRANCH_ID}/endpoints`);
  const endpoints = resp?.data?.endpoints || [];

  console.log('endpoints.count', endpoints.length);
  if (endpoints[0]) {
    console.log('endpoint[0].keys', Object.keys(endpoints[0]));
    console.log('endpoint[0].redacted', JSON.stringify(redact(endpoints[0]), null, 2));
  }
}

main().catch((e) => {
  console.error(e?.stack || e?.message || e);
  process.exitCode = 1;
});
