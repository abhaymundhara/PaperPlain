import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;
function isTruthy(val) {
  if (!val) return false;
  const v = String(val).toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

const INSECURE_SSL = isTruthy(process.env.INSECURE_SSL);
const IS_PROD =
  process.env.NODE_ENV === "production" || isTruthy(process.env.VERCEL);

const sslCa =
  typeof process.env.PGSSLROOTCERT === "string"
    ? process.env.PGSSLROOTCERT.trim()
    : "";

// Dev-only escape hatch for environments that intercept TLS (can surface as
// "self-signed certificate in certificate chain" when connecting to managed PG).
if (!IS_PROD && INSECURE_SSL) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

// Node-postgres ignores sslmode= in the URL; we must set ssl explicitly.
// In production we default to verifying certificates.
const sslConfig = IS_PROD
  ? { rejectUnauthorized: true, ...(sslCa ? { ca: sslCa } : {}) }
  : INSECURE_SSL
  ? { rejectUnauthorized: false }
  : { rejectUnauthorized: true, ...(sslCa ? { ca: sslCa } : {}) };

export const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig,
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
