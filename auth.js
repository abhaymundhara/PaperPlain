import dotenv from "dotenv";
import { betterAuth } from "better-auth";
import { pool as sharedPool } from "./db.js";

dotenv.config();

let cachedAuth;

export function getAuth() {
  if (cachedAuth !== undefined) return cachedAuth;
  if (!process.env.DATABASE_URL) {
    cachedAuth = null;
    return cachedAuth;
  }

  try {
    // better-auth will read BETTER_AUTH_SECRET from env automatically, but we
    // pass it explicitly so misconfiguration fails fast (and predictably).
    cachedAuth = betterAuth({
      secret: process.env.BETTER_AUTH_SECRET,
      baseURL: process.env.BETTER_AUTH_URL,
      basePath: "/api/better-auth",
      // Reuse the app's shared Postgres pool to avoid creating
      // multiple pools (which can cause hangs/exhaustion on serverless).
      database: sharedPool,
      emailAndPassword: {
        enabled: true,
      },
    });
  } catch (e) {
    console.error("[auth] better-auth init failed:", e);
    cachedAuth = null;
  }

  return cachedAuth;
}
