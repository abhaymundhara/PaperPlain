# Paper Plain

Academic Paper De-Jargoner — transform complex research papers into plain English summaries.

## Features

- 🔗 Paste any ArXiv URL
- 📖 Automatically fetches paper metadata and content
- 🤖 AI-powered summarization in simple language
- 💡 Defines the 3 most important technical terms
- 🎯 Bullet-pointed, easy-to-understand format

## Setup (Vercel-first)

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Configure environment variables:**

   ```bash
   cp .env.example .env
   ```

   Add your Groq API key and Vercel Postgres connection string to `.env`.

3. **Set up a hosted Postgres (free via Supabase):**

   - Create a free Supabase project at https://supabase.com (includes 500MB Postgres).
   - In Supabase: Project Settings → Database → Connection string → URI.
     - If the dashboard shows **Direct connection** as "Not IPv4 compatible" (IPv6-only), Vercel may not be able to reach it.
     - For Vercel, prefer **Session Pooler** (or **Transaction Pooler**) connection strings instead of Direct.
   - Copy the Postgres URL and set it as `DATABASE_URL` in `.env` and in your Vercel project envs.
   - Set `BETTER_AUTH_SECRET` to a long random value (generate with `npm run auth:secret`).
   - Set `BETTER_AUTH_URL` to your deployed URL (e.g. `https://paperplain.vercel.app`); keep `http://localhost:3000` for local dev.

   **TLS note:** The app enables Postgres TLS and verifies certificates in production by default. If you see `self-signed certificate in certificate chain` locally, do **not** disable verification in production—prefer providing your DB provider CA via `PGSSLROOTCERT`. The `INSECURE_SSL=true` escape hatch is intended for local development only.

4. **Create Better Auth tables (run once against the hosted DB):**

   ```bash
   DATABASE_URL="<your vercel postgres url>" npm run auth:migrate:yes
   ```

5. **Run locally (for dev):**

   ```bash
   npm run dev
   ```

   Open `http://localhost:3000`.

6. **Deploy to Vercel:**

   - Ensure the env vars (`GROQ_API_KEY`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`) are set in Vercel.
   - For **PDF uploads** on Vercel: Vercel’s filesystem is ephemeral, so uploaded PDFs must be stored in object storage.
     - Create a Supabase Storage bucket (e.g. `paperplain-pdfs`).
     - Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET` in Vercel.
     - If you want PDFs accessible by a direct link, make the bucket **Public** (or extend the API to return signed URLs for a Private bucket).
   - Deploy with the Vercel CLI or dashboard; `vercel.json` routes `/api/*` to the Express serverless function and serves `/public` as static files.

## How to Use

1. Find a paper on ArXiv (e.g., https://arxiv.org/abs/2301.00234)
2. Paste the URL into the input field
3. Click "Simplify Paper"
4. Get a plain English summary with key terms explained!

## Tech Stack

- Backend: Node.js + Express
- ArXiv API for paper fetching
- Groq API with Llama 3.3 70B for intelligent summarization
- Clean, responsive frontend

## API Endpoint

`POST /api/simplify`

- Body: `{ "arxivUrl": "https://arxiv.org/abs/..." }`
- Returns: Simplified summary with problem, methodology, conclusion, and key terms

## Auth Endpoints

- `POST /api/auth/signup` (email/password)
- `POST /api/auth/signin` (email/password)
- `POST /api/auth/signout`
- `GET /api/auth/me`

## Health Endpoints

- `GET /api/health` (basic)
- `GET /api/health/db` (checks Postgres connectivity; returns 503 on failure)

Note: Better Auth is mounted at `/api/better-auth/*` internally. The app exposes the simplified `/api/auth/*` endpoints for the vanilla JS frontend.
# Deployment: Fri Dec 19 02:24:01 GMT 2025
