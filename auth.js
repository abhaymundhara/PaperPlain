import dotenv from "dotenv";
import { betterAuth } from "better-auth";
import { Pool } from "pg";

dotenv.config();

export const auth = process.env.DATABASE_URL
  ? betterAuth({
      baseURL: process.env.BETTER_AUTH_URL,
      basePath: "/api/better-auth",
      database: new Pool({
        connectionString: process.env.DATABASE_URL,
      }),
      emailAndPassword: {
        enabled: true,
      },
    })
  : null;
