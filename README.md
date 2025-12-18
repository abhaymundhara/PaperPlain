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
   - In Supabase: Project Settings → Database → Connection string → URI; copy the Postgres URL (often ends with `?sslmode=require`).
   - Set that as `DATABASE_URL` in `.env` and in your Vercel project envs.
   - Set `BETTER_AUTH_SECRET` to a long random value (generate with `npm run auth:secret`).
   - Set `BETTER_AUTH_URL` to your deployed URL (e.g. `https://paperplain.vercel.app`); keep `http://localhost:3000` for local dev.

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

Note: Better Auth is mounted at `/api/better-auth/*` internally. The app exposes the simplified `/api/auth/*` endpoints for the vanilla JS frontend.

## License

MIT
