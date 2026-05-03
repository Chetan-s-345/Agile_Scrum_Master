import { Pool } from '@neondatabase/serverless';

let pool: Pool | null = null;

function ensurePool(): Pool {
  if (pool) return pool;
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    throw new Error('DATABASE_URL must be set in your environment variables');
  }
  pool = new Pool({ connectionString: conn });
  return pool;
}

export async function query(sql: string, params?: ReadonlyArray<unknown>) {
  // Lazily initialize the pool so importing this module doesn't fail during
  // build-time when env vars (like DATABASE_URL) may not be available.
  const p = ensurePool();
  const client = await p.connect();
  try {
    if (params === undefined) {
      return await client.query(sql);
    }
    return await client.query(sql, Array.from(params));
  } finally {
    client.release();
  }
}
