function normalizeTenantDbConnectionString(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw Object.assign(
      new Error('tenantDbConnectionString must be a valid Postgres/Neon connection string (postgres:// or postgresql://).'),
      { statusCode: 400 }
    );
  }

  const protocol = String(parsed.protocol || '').toLowerCase();
  if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
    throw Object.assign(
      new Error('tenantDbConnectionString must use postgres:// or postgresql://.'),
      { statusCode: 400 }
    );
  }

  if (!parsed.hostname) {
    throw Object.assign(new Error('tenantDbConnectionString must include a hostname.'), { statusCode: 400 });
  }

  return raw;
}

function requireTenantDbConnectionForManualMode(connectionString, provisioningMode) {
  if (provisioningMode !== 'manual') return;
  if (connectionString) return;

  throw Object.assign(
    new Error(
      'tenantDbConnectionString is required when TENANT_DB_PROVISIONING_MODE=manual. Provide a per-org Postgres/Neon connection string.'
    ),
    { statusCode: 400 }
  );
}

module.exports = {
  normalizeTenantDbConnectionString,
  requireTenantDbConnectionForManualMode,
};
