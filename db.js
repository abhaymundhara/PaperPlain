import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;

export const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
    })
  : null;

export async function dbHealthCheck() {
  if (!pool) return false;
  const client = await pool.connect();
  try {
    await client.query("SELECT 1 as ok");
    return true;
  } finally {
    client.release();
  }
}
