import dotenv from "dotenv";

dotenv.config();

let cachedAuth;
let initPromise;

export async function getAuth() {
  if (cachedAuth !== undefined) return cachedAuth;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!process.env.DATABASE_URL) {
      cachedAuth = null;
      return cachedAuth;
    }

    try {
      const { betterAuth } = await import("better-auth");
      const { pool: sharedPool } = await import("./db.js");
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
        socialProviders: {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID || "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
            enabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
          },
        },
      });
    } catch (e) {
      console.error("[auth] better-auth init failed:", e);
      cachedAuth = null;
    } finally {
      initPromise = null;
    }

    return cachedAuth;
  })();

  return initPromise;
}
