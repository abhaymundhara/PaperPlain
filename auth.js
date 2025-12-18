import dotenv from "dotenv";
import { betterAuth } from "better-auth";
import { Pool } from "pg";

dotenv.config();

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

// Never disable TLS verification in production.
const sslConfig = IS_PROD
  ? { rejectUnauthorized: true, ...(sslCa ? { ca: sslCa } : {}) }
  : INSECURE_SSL
  ? { rejectUnauthorized: false }
  : { rejectUnauthorized: true, ...(sslCa ? { ca: sslCa } : {}) };

const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
  // Avoid indefinite hangs in serverless environments.
  connectionTimeoutMillis: 10000,
  statement_timeout: 15000,
  query_timeout: 15000,
  ...(IS_PROD ? { max: 1, idleTimeoutMillis: 30000 } : {}),
};

export const auth = process.env.DATABASE_URL
  ? (() => {
      try {
        return betterAuth({
          baseURL: process.env.BETTER_AUTH_URL,
          basePath: "/api/better-auth",
          database: new Pool({
            ...poolConfig,
          }),
          emailAndPassword: {
            enabled: true,
          },
        });
      } catch (e) {
        console.error("[auth] better-auth init failed:", e);
        return null;
      }
    })()
  : null;
