const axios = require('axios');
const { Pool } = require('pg');
const { logger } = require('../../src/middleware/logger');

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const VECTOR_DIMENSIONS = Number(process.env.VECTOR_DIMENSIONS || '1536');
const OPENAI_BASE_URL = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');

let pool = null;
let schemaReady = false;

function getDatabaseUrl() {
  const url = process.env.UNIVERSAL_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Missing UNIVERSAL_DATABASE_URL or DATABASE_URL for embeddings storage.');
  }
  return String(url);
}

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: getDatabaseUrl(), ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

function toVectorLiteral(vector) {
  return `[${vector.map((v) => Number(v).toFixed(8)).join(',')}]`;
}

function averageVectors(vectors) {
  if (!vectors.length) return null;
  const size = vectors[0].length;
  const sum = new Array(size).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < size; i += 1) {
      sum[i] += Number(vector[i] || 0);
    }
  }
  return sum.map((v) => v / vectors.length);
}

async function ensureEmbeddingsInfrastructure() {
  if (schemaReady) return;
  if (!Number.isInteger(VECTOR_DIMENSIONS) || VECTOR_DIMENSIONS <= 0) {
    throw new Error('VECTOR_DIMENSIONS must be a positive integer.');
  }

  const client = await getPool().connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
    await client.query(
      `CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        content TEXT NOT NULL,
        vector vector(${VECTOR_DIMENSIONS}),
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(source_id, source_type)
      );`
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS embeddings_vector_ivfflat_idx ON embeddings USING ivfflat (vector vector_cosine_ops) WITH (lists = 100);'
    );
    await client.query('CREATE INDEX IF NOT EXISTS embeddings_project_type_idx ON embeddings (project_id, source_type);');
    schemaReady = true;
  } finally {
    client.release();
  }
}

function chunkText(text, maxChars = 2000) {
  const normalized = String(text || '');
  if (!normalized) return [];

  const overlap = 200;
  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + maxChars, normalized.length);
    chunks.push(normalized.slice(start, end));
    if (end === normalized.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

async function embedText(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn('OPENAI_API_KEY is not set; embedText() returning null.');
    return null;
  }

  const input = String(text || '').slice(0, 8000);
  if (!input.trim()) return null;

  try {
    const response = await axios.post(
      `${OPENAI_BASE_URL}/embeddings`,
      { model: EMBEDDING_MODEL, input },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const vector = response?.data?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== VECTOR_DIMENSIONS) {
      logger.warn({ length: Array.isArray(vector) ? vector.length : -1 }, 'Embedding vector has unexpected dimensions.');
      return null;
    }
    return vector.map((v) => Number(v));
  } catch (error) {
    logger.error({ error: error?.message || String(error) }, 'embedText failed.');
    return null;
  }
}

async function upsertEmbedding({ sourceType, sourceId, projectId, content, metadata = {} }) {
  try {
    await ensureEmbeddingsInfrastructure();
    const chunks = chunkText(content);
    if (!chunks.length) return false;

    const vectors = [];
    for (const chunk of chunks) {
      const vector = await embedText(chunk);
      if (vector) vectors.push(vector);
    }
    if (!vectors.length) return false;

    const merged = averageVectors(vectors);
    const id = `${sourceType}:${sourceId}`;
    const payloadMeta = {
      ...metadata,
      chunk_count: chunks.length,
      embedded_chunks: vectors.length,
      embedding_model: EMBEDDING_MODEL,
    };

    await getPool().query(
      `INSERT INTO embeddings (id, source_type, source_id, project_id, content, vector, metadata, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb, NOW())
       ON CONFLICT (source_id, source_type)
       DO UPDATE SET
         id = EXCLUDED.id,
         project_id = EXCLUDED.project_id,
         content = EXCLUDED.content,
         vector = EXCLUDED.vector,
         metadata = EXCLUDED.metadata,
         updated_at = NOW();`,
      [id, sourceType, sourceId, projectId, String(content || ''), toVectorLiteral(merged), JSON.stringify(payloadMeta)]
    );

    return true;
  } catch (error) {
    logger.error({ error: error?.message || String(error), sourceType, sourceId }, 'upsertEmbedding failed.');
    return false;
  }
}

async function searchSimilar({ query, projectId, sourceTypes, limit = 8 }) {
  try {
    await ensureEmbeddingsInfrastructure();
    const qv = await embedText(query);
    if (!qv) return [];

    const typeFilter = Array.isArray(sourceTypes) && sourceTypes.length ? sourceTypes : null;
    const cappedLimit = Math.max(1, Math.min(Number(limit) || 8, 50));

    const result = await getPool().query(
      `SELECT id, source_type, source_id, project_id, content, metadata,
              1 - (vector <=> $1::vector) AS similarity
       FROM embeddings
       WHERE project_id = $2
         AND ($3::text[] IS NULL OR source_type = ANY($3::text[]))
       ORDER BY vector <=> $1::vector
       LIMIT $4;`,
      [toVectorLiteral(qv), projectId, typeFilter, cappedLimit]
    );

    return result.rows.map((row) => ({
      similarity: Number(row.similarity),
      content: row.content,
      metadata: row.metadata || {},
      sourceType: row.source_type,
      sourceId: row.source_id,
      projectId: row.project_id,
      id: row.id,
    }));
  } catch (error) {
    logger.error({ error: error?.message || String(error) }, 'searchSimilar failed.');
    return [];
  }
}

module.exports = {
  embedText,
  chunkText,
  upsertEmbedding,
  searchSimilar,
  ensureEmbeddingsInfrastructure,
};
