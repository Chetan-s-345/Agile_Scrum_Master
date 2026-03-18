function getNeonErrorStatus(err) {
  const s = err?.status ?? err?.cause?.status;
  return typeof s === 'number' ? s : null;
}

function extractNeonErrorDetail(err) {
  const data = err?.data ?? err?.cause?.data;
  if (!data) return null;
  if (typeof data === 'string') return data.slice(0, 500);

  // Neon error payloads commonly include { message } or { error }.
  const msg = data?.message || data?.error || data?.detail || data?.title;
  if (typeof msg === 'string' && msg.trim()) return msg.trim().slice(0, 500);
  return null;
}

function mapNeonProvisioningError(err) {
  const status = getNeonErrorStatus(err);
  const detail = extractNeonErrorDetail(err);
  const message = String(err?.message || '').toLowerCase();
  const detailLower = String(detail || '').toLowerCase();

  if (message.includes('neon_org_id is required')) {
    return Object.assign(new Error(err.message), { statusCode: 400, cause: err });
  }

  if (detailLower.includes('org_id is required')) {
    return Object.assign(
      new Error(
        'Neon requires org_id for project creation. The gateway attempted to auto-resolve it from your Neon profile/projects but could not. Set NEON_ORG_ID in backend/api-gateway/.env (recommended) or pass neonOrgId (org-...) in the provision-db request.'
      ),
      { statusCode: 400, cause: err }
    );
  }

  if (detailLower.includes('subject_org_id') && detailLower.includes('requested_org_id')) {
    return Object.assign(
      new Error('NEON_ORG_ID does not match the organization allowed by the provided Neon key. Use the correct org id for that key.'),
      { statusCode: 400, cause: err }
    );
  }

  if (status === 401 || status === 403) {
    return Object.assign(
      new Error(
        'Neon API authentication failed. Check NEON_API_KEY (must be a Neon API key like napi_..., not a PostgREST URL or connection string).'
      ),
      { statusCode: 400, cause: err }
    );
  }

  if (status === 429) {
    return Object.assign(new Error('Neon API rate limit reached. Please retry in a minute.'), {
      statusCode: 429,
      cause: err,
    });
  }

  if (status === 422) {
    const base =
      'Neon rejected the project creation request (often due to an invalid project name). Try using an org slug with only letters/numbers/hyphens.';
    return Object.assign(new Error(detail ? `${base} (${detail})` : base), { statusCode: 400, cause: err });
  }

  if (status && status >= 500) {
    return Object.assign(new Error('Neon API is temporarily unavailable. Please retry shortly.'), {
      statusCode: 503,
      cause: err,
    });
  }

  return Object.assign(new Error('Neon project provisioning failed. Verify Neon API access and try again.'), {
    statusCode: 400,
    cause: err,
  });
}

module.exports = {
  mapNeonProvisioningError,
  extractNeonErrorDetail,
  getNeonErrorStatus,
};
