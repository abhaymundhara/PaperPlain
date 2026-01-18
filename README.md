# Paper Plain

**Transform complex research papers into plain English summaries.**

Paper Plain is an AI-powered academic paper simplification tool that makes research accessible to everyone. Whether you're a student, researcher, or curious learner, Paper Plain helps you quickly understand academic papers without getting lost in technical jargon.

## 🎯 What is Paper Plain?

Paper Plain takes academic research papers (from ArXiv or uploaded PDFs) and uses advanced AI to generate clear, concise summaries. Instead of struggling through dense academic prose, you get:

- **Plain English explanations** of the research problem, methodology, and conclusions
- **Key term definitions** for the most important technical concepts
- **Smart Q&A** to ask follow-up questions about the paper
- **Personal library** to save and organize papers by project or tags
- **Notes and annotations** to track your thoughts alongside each paper

Perfect for literature reviews, staying current in your field, or exploring new research areas without a steep learning curve.

## ✨ Key Features

- 🔗 **ArXiv Integration** - Paste any ArXiv URL for instant summarization
- 📄 **PDF Upload** - Upload any research paper PDF
- 🤖 **AI-Powered Summaries** - Powered by Groq API with Llama 3.3 70B
- 💬 **Interactive Q&A** - Ask questions about the paper and get AI answers
- 💾 **Save & Organize** - Build your personal library with projects and tags
- 📝 **Note-Taking** - Add your own notes to each paper
- 📋 **BibTeX Export** - Easy citation management
- 🔐 **User Authentication** - Sign in with email/password or Google OAuth

## 🚀 Quick Start

### Prerequisites

- Node.js (v18 or higher)
- PostgreSQL database (free tier available via [Supabase](https://supabase.com))
- Groq API key (get one at [Groq Console](https://console.groq.com))

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/abhaymundhara/PaperPlain.git
   cd PaperPlain
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**

   Create a `.env` file in the root directory:
   ```bash
   # Required
   GROQ_API_KEY=your_groq_api_key
   DATABASE_URL=your_postgres_connection_string
   BETTER_AUTH_SECRET=your_random_secret_key
   BETTER_AUTH_URL=http://localhost:3000

   # Optional - for Google OAuth
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret

   # Optional - for PDF uploads on Vercel
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_key
   SUPABASE_STORAGE_BUCKET=paperplain-pdfs
   ```

   Generate a secret key:
   ```bash
   npm run auth:secret
   ```

4. **Set up the database**

   Run the Better Auth migration to create required tables:
   ```bash
   npm run auth:migrate:yes
   ```

5. **Run the application**
   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

## 🔧 Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Vanilla JavaScript (no framework dependencies)
- **Database**: PostgreSQL (Supabase recommended)
- **Authentication**: [Better Auth](https://www.better-auth.com/) with email/password and Google OAuth
- **AI**: Groq API with Llama 3.3 70B for summarization
- **Paper Source**: ArXiv API + PDF parsing
- **Storage**: Supabase Storage for PDF uploads (optional)

## 📖 How to Use

1. **Sign in** to your account (or continue without authentication for basic features)
2. **Paste an ArXiv URL** (e.g., `https://arxiv.org/abs/2301.00234`) or **upload a PDF**
3. **Click "Simplify"** to generate a plain English summary
4. **Read the summary** with problem, methodology, conclusion, and key terms
5. **Ask questions** using the Q&A panel
6. **Save papers** to your library with projects and tags
7. **Add notes** to remember important insights

## 🌐 Deployment

### Vercel (Recommended)

This project is optimized for deployment on Vercel:

1. **Connect your repository** to Vercel
2. **Set environment variables** in Vercel dashboard (same as `.env` file)
3. **Deploy** - Vercel will automatically build and deploy

**Important**: 
- Use Supabase **Session Pooler** or **Transaction Pooler** connection strings (not Direct connection)
- Set up Supabase Storage for PDF uploads in production
- Ensure `BETTER_AUTH_URL` points to your deployed URL

For detailed deployment instructions, see the [Setup (Vercel-first)](#-setup-vercel-first) section below.

## 🔐 Google OAuth Setup

To enable "Sign in with Google":

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google+ API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Set authorized redirect URIs:
   - Development: `http://localhost:3000/api/better-auth/google/callback`
   - Production: `https://yourdomain.com/api/better-auth/google/callback`
6. Copy the **Client ID** and **Client Secret** to your `.env` file

## 📚 API Reference

### Simplify Endpoints

- `POST /api/simplify` - Simplify an ArXiv paper
- `POST /api/simplify/pdf` - Upload and simplify a PDF

### Auth Endpoints

- `POST /api/auth/signup` - Create a new account
- `POST /api/auth/signin` - Sign in with email/password
- `POST /api/auth/signout` - Sign out
- `GET /api/auth/me` - Get current user session
- Better Auth routes at `/api/better-auth/*` (includes Google OAuth)

### Paper Management

- `GET /api/papers` - List saved papers
- `GET /api/papers/:id` - Get a specific paper
- `POST /api/papers/import` - Save an ArXiv paper
- `POST /api/papers/manual` - Save a custom paper
- `PATCH /api/papers/:id` - Update paper (notes, tags, project)
- `DELETE /api/papers/:id` - Delete a paper

### Q&A Endpoints

- `POST /api/qa/live` - Ask a question about the current paper
- `POST /api/qa/saved/:id` - Ask a question about a saved paper

## 📋 Setup (Vercel-first)

<details>
<summary>Click to expand detailed Vercel deployment guide</summary>

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

   - Ensure the env vars (`GROQ_API_KEY`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) are set in Vercel.
   - For **PDF uploads** on Vercel: Vercel’s filesystem is ephemeral, so uploaded PDFs must be stored in object storage.
     - Create a Supabase Storage bucket (e.g. `paperplain-pdfs`).
     - Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET` in Vercel.
     - If you want PDFs accessible by a direct link, make the bucket **Public** (or extend the API to return signed URLs for a Private bucket).
   - Deploy with the Vercel CLI or dashboard; `vercel.json` routes `/api/*` to the Express serverless function and serves `/public` as static files.

</details>

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- Powered by [Groq](https://groq.com/) for fast AI inference
- Built with [Better Auth](https://www.better-auth.com/) for authentication
- Paper data from [ArXiv](https://arxiv.org/)

---

**Note**: This is an open-source project built to make academic research more accessible. For questions or support, please open an issue on GitHub.
