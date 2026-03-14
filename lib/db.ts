import { Pool } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set in your environment variables');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function query(sql: string, params?: ReadonlyArray<unknown>) {
  const client = await pool.connect();
  try {
    if (params === undefined) {
      return await client.query(sql);
    }
    return await client.query(sql, Array.from(params));
  } finally {
    client.release();
  }
}
