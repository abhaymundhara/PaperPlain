import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import xml2js from "xml2js";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import Groq from "groq-sdk";
import { APIError } from "better-auth/api";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { getAuth } from "./auth.js";
import { dbHealthCheck, pool } from "./db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const SKIP_AUTH = process.env.SKIP_AUTH === "true";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();
const SUPABASE_STORAGE_BUCKET = (
  process.env.SUPABASE_STORAGE_BUCKET || "paperplain-pdfs"
).trim();

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Note: Vercel/serverless filesystems are ephemeral and the project directory
// may be read-only. Only use disk uploads in local/dev, and prefer /tmp.
const uploadsDir = process.env.VERCEL
  ? path.join("/tmp", "paperplain-uploads")
  : path.join(__dirname, "public", "uploads");

if (!supabase) {
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
  } catch (e) {
    // If this fails in a restricted environment, we'll surface a clearer error
    // when the PDF endpoint is used.
  }
}

function safeUploadFilename(originalname) {
  const base = (originalname || "upload.pdf")
    .toString()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const timestamp = Date.now();
  const rand = Math.random().toString(16).slice(2, 10);
  return `${timestamp}-${rand}-${base || "upload.pdf"}`;
}

const pdfUpload = multer({
  storage: supabase
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadsDir),
        filename: (_req, file, cb) =>
          cb(null, safeUploadFilename(file.originalname)),
      }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === "application/pdf" ||
      (file.originalname || "").toLowerCase().endsWith(".pdf");
    if (!isPdf) return cb(new Error("Only PDF files are supported"));
    cb(null, true);
  },
});

async function uploadPdfToSupabaseStorage({
  buffer,
  contentType,
  originalName,
}) {
  if (!supabase) {
    throw new Error(
      "Supabase Storage is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)"
    );
  }

  const safeName = safeUploadFilename(originalName || "upload.pdf");
  const objectPath = `pdf/${safeName}`;

  const { error } = await supabase.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .upload(objectPath, buffer, {
      contentType: contentType || "application/pdf",
      upsert: false,
    });

  if (error) {
    throw new Error(error.message || "Failed to upload PDF to storage");
  }

  const { data } = supabase.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .getPublicUrl(objectPath);

  const url = data?.publicUrl;
  if (!url) throw new Error("Failed to get public URL for uploaded PDF");
  return url;
}

function normalizeKeyTermsHeading(text) {
  return (text || "")
    .replace(/^\s*(\*\*\s*)?Key\s*Terms\s*:\s*(\*\*)?\s*$/gim, "**Key Terms:**")
    .replace(/^\s*(\*\*\s*)?Key\s*Terms\s*:\s*(\*\*)?/gim, "**Key Terms:**");
}

function clampText(value, maxLen) {
  return (value || "").toString().trim().slice(0, maxLen);
}

function extractAbstractFromPdfText(text) {
  const src = (text || "").toString().replace(/\r\n/g, "\n");
  const idx = src.search(/\n\s*abstract\s*\n|\n\s*abstract\s*:/i);
  if (idx === -1) return "";

  const tail = src.slice(idx).replace(/^\s*\n\s*/g, "");
  const after = tail.replace(/^abstract\s*(?:\n|:)/i, "").trim();

  // Stop at common next-section headings.
  const stopIdx = after.search(
    /\n\s*(?:keywords?|index terms|introduction|1\s*\.\s*introduction|i\s*\.\s*introduction|contents)\b/i
  );

  const abstract = (stopIdx === -1 ? after : after.slice(0, stopIdx)).trim();
  return abstract.replace(/\s+/g, " ");
}

function guessTitleAuthorsFromPdfText(text) {
  const lines = (text || "")
    .toString()
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const titleCandidates = lines
    .slice(0, 40)
    .filter((l) => l.length >= 10 && l.length <= 180)
    .filter((l) => /[a-zA-Z]/.test(l));

  const title = titleCandidates.length ? titleCandidates[0] : "Uploaded PDF";

  // Authors are often in the next couple lines after title.
  const titleIndex = lines.findIndex((l) => l === title);
  const authorWindow =
    titleIndex >= 0 ? lines.slice(titleIndex + 1, titleIndex + 6) : [];
  const authorsLine = authorWindow.find(
    (l) =>
      l.length <= 200 &&
      /,| and |\b[A-Z][a-z]+\b/.test(l) &&
      !/^abstract\b/i.test(l)
  );

  return {
    title: clampText(title, 400) || "Uploaded PDF",
    authors: clampText(authorsLine || "", 600),
  };
}

function parseLabeledPdfExtraction(raw) {
  const text = (raw || "").toString().replace(/\r\n/g, "\n");
  const getBlock = (label) => {
    const re = new RegExp(`(?:^|\\n)${label}:\\s*`, "i");
    const m = text.match(re);
    if (!m || m.index == null) return "";
    const start = m.index + m[0].length;
    const rest = text.slice(start);
    const next = rest.search(/\n\s*(?:TITLE|AUTHORS|ABSTRACT|SUMMARY)\s*:\s*/i);
    return (next === -1 ? rest : rest.slice(0, next)).trim();
  };

  return {
    title: getBlock("TITLE"),
    authors: getBlock("AUTHORS"),
    abstract: getBlock("ABSTRACT"),
    summary: getBlock("SUMMARY"),
  };
}

// Initialize Groq
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Middleware
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

// Better Auth handler (must be mounted before express.json)
app.all("/api/better-auth/*", (req, res) => {
  const auth = getAuth();
  if (!auth) {
    return res.status(503).json({
      message: "Auth is not configured. Set DATABASE_URL to enable it.",
    });
  }
  return toNodeHandler(auth)(req, res);
});

app.use(express.json());
app.use(express.static("public"));

async function ensurePapersTable() {
  if (!pool) return;
  await pgQuery(
    `
    CREATE TABLE IF NOT EXISTS papers (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      arxiv_id TEXT,
      title TEXT NOT NULL,
      authors TEXT,
      abstract TEXT,
      pdf_url TEXT,
      summary TEXT,
      notes TEXT,
      project TEXT,
      tags TEXT[],
      qa_history JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, arxiv_id)
    );
  `,
    [],
    "ensurePapersTable.create"
  );

  await pgQuery(
    `ALTER TABLE papers ADD COLUMN IF NOT EXISTS project TEXT;`,
    [],
    "ensurePapersTable.alter.project"
  );
  await pgQuery(
    `ALTER TABLE papers ADD COLUMN IF NOT EXISTS tags TEXT[];`,
    [],
    "ensurePapersTable.alter.tags"
  );
  await pgQuery(
    `ALTER TABLE papers ADD COLUMN IF NOT EXISTS qa_history JSONB DEFAULT '[]'::jsonb;`,
    [],
    "ensurePapersTable.alter.qa_history"
  );
}

function requireAuthSession() {
  return async (req, res, next) => {
    if (SKIP_AUTH) {
      req.user = { id: "dev-user", email: "dev@example.com" };
      return next();
    }
    const auth = getAuth();
    if (!auth) return res.status(401).json({ message: "Sign in required" });
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (!session?.user?.id) {
        return res.status(401).json({ message: "Sign in required" });
      }
      req.user = session.user;
      next();
    } catch (error) {
      return res.status(401).json({ message: "Sign in required" });
    }
  };
}

// Extract ArXiv ID from URL
function extractArxivId(url) {
  const patterns = [
    /arxiv\.org\/abs\/([0-9.]+)/,
    /arxiv\.org\/pdf\/([0-9.]+)/,
    /([0-9]{4}\.[0-9]{4,5})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  throw new Error("Invalid ArXiv URL format");
}

function decodeHtmlEntities(input) {
  return (input || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

app.get("/api/arxiv/:id/bibtex", requireAuthSession(), async (req, res) => {
  try {
    const arxivId = (req.params.id || "").toString().trim();
    if (!/^[0-9]{4}\.[0-9]{4,5}$/.test(arxivId)) {
      return res.status(400).json({ message: "Invalid arXiv ID" });
    }

    const url = `https://arxiv.org/bibtex/${arxivId}`;
    const response = await axios.get(url, {
      responseType: "text",
      headers: { "User-Agent": "PaperPlain/1.0" },
      timeout: 15000,
    });

    let text = (response.data || "").toString();
    const pre = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (pre?.[1]) text = pre[1];

    text = decodeHtmlEntities(text).replace(/\r\n/g, "\n").trim();

    if (!text || !text.includes("@")) {
      return res.status(502).json({ message: "Failed to fetch BibTeX" });
    }

    res.json({ success: true, bibtex: text });
  } catch (error) {
    res
      .status(500)
      .json({ message: error.message || "Failed to fetch BibTeX" });
  }
});

// Fetch paper metadata from ArXiv API
async function fetchArxivPaper(arxivId) {
  try {
    const apiUrl = `http://export.arxiv.org/api/query?id_list=${arxivId}`;
    const response = await axios.get(apiUrl);

    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response.data);

    if (!result.feed.entry || result.feed.entry.length === 0) {
      throw new Error("Paper not found");
    }

    const entry = result.feed.entry[0];

    return {
      title: entry.title[0].trim().replace(/\s+/g, " "),
      authors: entry.author.map((a) => a.name[0]).join(", "),
      abstract: entry.summary[0].trim().replace(/\s+/g, " "),
      published: entry.published[0],
      arxivId: arxivId,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
    };
  } catch (error) {
    throw new Error(`Failed to fetch paper: ${error.message}`);
  }
}

function assertString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    const message = `${fieldName} is required`;
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
  return value.trim();
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(
        `${
          label || "Operation"
        } timed out after ${ms}ms. This usually means the database connection is blocked or misconfigured.`
      );
      err.statusCode = 504;
      reject(err);
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function pgQuery(queryText, params, label) {
  if (!pool) {
    const err = new Error("Database not configured");
    err.statusCode = 503;
    throw err;
  }
  return withTimeout(pool.query(queryText, params), 8000, label || "pg.query");
}

async function pipeWebResponseToExpress(res, response) {
  res.status(response.status);

  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === "set-cookie") continue;
    res.setHeader(key, value);
  }

  const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
  if (typeof getSetCookie === "function") {
    const cookies = getSetCookie();
    if (cookies?.length) {
      res.setHeader("set-cookie", cookies);
    }
  } else {
    const cookie = response.headers.get("set-cookie");
    if (cookie) {
      res.setHeader("set-cookie", cookie);
    }
  }

  const body = await response.text();
  res.send(body);
}

// Simplify paper using Groq
async function simplifyPaper(paperData) {
  const prompt = `You are an expert at explaining complex academic research in simple, plain English.

Paper Title: ${paperData.title}
Abstract: ${paperData.abstract}

Please provide a clear, concise summary that includes:

1. THE PROBLEM: What problem is this research trying to solve? (2-3 sentences)

2. THE METHOD: How did they approach it? What did they do? (2-3 sentences)

3. THE CONCLUSION: What did they find? Why does it matter? (2-3 sentences)

4. KEY TERMS: Define the 3 most important technical terms from this paper in simple language.

Format your response as follows:
**The Problem:**
[Your explanation]

**The Method:**
[Your explanation]

**The Conclusion:**
[Your explanation]

**Key Terms:**
• **Term 1**: Definition
• **Term 2**: Definition
• **Term 3**: Definition

Use simple language, avoid jargon, and make it accessible to someone without expertise in this field.`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You are an expert at translating complex academic papers into clear, simple English that anyone can understand.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    let text = (completion.choices?.[0]?.message?.content || "").trim();

    // Normalize Key Terms heading for the frontend parser.
    text = text.replace(
      /^(\*\*\s*)?Key\s*Terms\s*:\s*(\*\*)?/gim,
      "**Key Terms:**"
    );

    // If the model omitted key terms, add them via a small follow-up.
    if (!/\bKey\s*Terms\b/i.test(text)) {
      const keyTermsPrompt = `Return ONLY the Key Terms section in the exact format below. No extra text.

**Key Terms:**
• **Term 1**: Definition
• **Term 2**: Definition
• **Term 3**: Definition

Paper Title: ${paperData.title}
Abstract: ${paperData.abstract}
Existing Summary: ${text}`;

      const keyTermsCompletion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content:
              "You extract key terms and define them simply. Output must match the requested format exactly.",
          },
          { role: "user", content: keyTermsPrompt },
        ],
        temperature: 0.2,
        max_tokens: 250,
      });

      const keyTermsText = (
        keyTermsCompletion.choices?.[0]?.message?.content || ""
      )
        .trim()
        .replace(/^(\*\*\s*)?Key\s*Terms\s*:\s*(\*\*)?/gim, "**Key Terms:**");

      if (keyTermsText) {
        text = `${text}\n\n${keyTermsText}`.trim();
      }
    }

    return text;
  } catch (error) {
    throw new Error(`Failed to generate summary: ${error.message}`);
  }
}

async function answerQuestion({ question, paper }) {
  const context = `Title: ${paper.title || ""}
Authors: ${paper.authors || ""}
Abstract: ${paper.abstract || ""}
Summary: ${paper.summary || ""}`;

  const qaPrompt = `You are answering questions about a paper using its abstract/summary. Keep answers concise (4-6 sentences max). If the question cannot be answered from the provided text, say so briefly.

${context}

Question: ${question}
Answer:`;

  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content:
          "Answer based only on the provided paper text. Be concise and avoid speculation.",
      },
      { role: "user", content: qaPrompt },
    ],
    temperature: 0.2,
    max_tokens: 400,
  });

  const answer = completion.choices[0].message.content;
  const sources = buildQaSources({ question, paper });

  return { answer, sources };
}

function tokenizeForQa(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function buildQaSources({ question, paper }) {
  const questionTokens = new Set(tokenizeForQa(question));
  if (!questionTokens.size) return [];

  const candidates = [];

  const abstract =
    typeof paper?.abstract === "string" ? paper.abstract.trim() : "";
  if (abstract) {
    candidates.push({ label: "Abstract", text: abstract });
  }

  const summary =
    typeof paper?.summary === "string" ? paper.summary.trim() : "";
  if (summary) {
    // Split into reasonably sized snippets.
    const parts = summary
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .flatMap((line) => line.split(/(?<=[.!?])\s+/g).map((s) => s.trim()));

    for (const part of parts) {
      if (part.length < 40) continue;
      candidates.push({ label: "Summary", text: part });
    }
  }

  const scored = candidates
    .map((c) => {
      const tokens = tokenizeForQa(c.text);
      let score = 0;
      for (const t of tokens) {
        if (questionTokens.has(t)) score += 1;
      }

      // Prefer shorter, denser snippets.
      score = score / Math.max(8, Math.sqrt(tokens.length));
      return { ...c, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const out = [];
  const seen = new Set();
  for (const item of scored) {
    const normalized = item.text.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({
      label: item.label,
      text:
        item.text.length > 220
          ? item.text.slice(0, 217).trimEnd() + "…"
          : item.text,
    });
    if (out.length >= 3) break;
  }

  return out;
}

// Auth wrapper routes (vanilla JS frontend; Better Auth remains mounted separately)
app.post("/api/auth/signup", async (req, res) => {
  const auth = getAuth();
  if (!auth) {
    return res.status(503).json({
      message: "Auth is not configured. Set DATABASE_URL to enable it.",
    });
  }

  const reqId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const startedAt = Date.now();
  try {
    const name = assertString(req.body?.name, "name");
    const email = assertString(req.body?.email, "email");
    const password = assertString(req.body?.password, "password");

    console.log("[auth] signup:start", { reqId });

    const response = await withTimeout(
      auth.api.signUpEmail({
        headers: fromNodeHeaders(req.headers),
        body: {
          name,
          email,
          password,
        },
        asResponse: true,
      }),
      12000,
      "auth.signUpEmail"
    );

    await pipeWebResponseToExpress(res, response);
  } catch (error) {
    console.error("[auth] signup:error", {
      reqId,
      durationMs: Date.now() - startedAt,
      message: error?.message,
    });
    if (error instanceof APIError) {
      return res.status(error.status).json({
        message: error.message,
      });
    }

    const statusCode = error?.statusCode ?? 500;
    res.status(statusCode).json({
      message: error?.message ?? "Failed to sign up",
      reqId,
    });
  } finally {
    console.log("[auth] signup:end", {
      reqId,
      durationMs: Date.now() - startedAt,
    });
  }
});

app.post("/api/auth/signin", async (req, res) => {
  const auth = getAuth();
  if (!auth) {
    return res.status(503).json({
      message: "Auth is not configured. Set DATABASE_URL to enable it.",
    });
  }
  const reqId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const startedAt = Date.now();
  try {
    const email = assertString(req.body?.email, "email");
    const password = assertString(req.body?.password, "password");

    console.log("[auth] signin:start", { reqId });

    const response = await withTimeout(
      auth.api.signInEmail({
        headers: fromNodeHeaders(req.headers),
        body: {
          email,
          password,
          rememberMe: true,
        },
        asResponse: true,
      }),
      12000,
      "auth.signInEmail"
    );

    await pipeWebResponseToExpress(res, response);
  } catch (error) {
    console.error("[auth] signin:error", {
      reqId,
      durationMs: Date.now() - startedAt,
      message: error?.message,
    });
    if (error instanceof APIError) {
      return res.status(error.status).json({
        message: error.message,
      });
    }

    const statusCode = error?.statusCode ?? 500;
    res.status(statusCode).json({
      message: error?.message ?? "Failed to sign in",
      reqId,
    });
  } finally {
    console.log("[auth] signin:end", {
      reqId,
      durationMs: Date.now() - startedAt,
    });
  }
});

app.post("/api/auth/signout", async (req, res) => {
  const auth = getAuth();
  if (!auth) {
    return res.status(503).json({
      message: "Auth is not configured. Set DATABASE_URL to enable it.",
    });
  }
  try {
    const response = await auth.api.signOut({
      headers: fromNodeHeaders(req.headers),
      asResponse: true,
    });

    await pipeWebResponseToExpress(res, response);
  } catch (error) {
    if (error instanceof APIError) {
      return res.status(error.status).json({
        message: error.message,
      });
    }

    res.status(500).json({
      message: error?.message ?? "Failed to sign out",
    });
  }
});

app.get("/api/auth/me", async (req, res) => {
  if (SKIP_AUTH) {
    return res.json({ user: { id: "dev-user", email: "dev@example.com" } });
  }
  const auth = getAuth();
  if (!auth) {
    return res.json(null);
  }
  try {
    const session = await withTimeout(
      auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      }),
      8000,
      "auth.getSession"
    );
    res.json(session);
  } catch (error) {
    res.status(500).json({
      message: error?.message ?? "Failed to get session",
    });
  }
});

app.get("/api/health/db", async (_req, res) => {
  try {
    const ok = await withTimeout(dbHealthCheck(), 6000, "dbHealthCheck");
    res.json({ ok, databaseConfigured: Boolean(pool) });
  } catch (error) {
    res.status(503).json({
      ok: false,
      databaseConfigured: Boolean(pool),
      message: error?.message || "Database check failed",
    });
  }
});

// API Routes
app.post("/api/simplify", async (req, res) => {
  try {
    const { arxivUrl } = req.body;

    if (!arxivUrl) {
      return res.status(400).json({ error: "ArXiv URL is required" });
    }

    // Extract ArXiv ID
    const arxivId = extractArxivId(arxivUrl);

    // Fetch paper data
    const paperData = await fetchArxivPaper(arxivId);

    // Generate simplified summary
    const summary = await simplifyPaper(paperData);

    res.json({
      success: true,
      data: {
        ...paperData,
        simplifiedSummary: summary,
      },
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/api/simplify/pdf", pdfUpload.single("pdf"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: "PDF is required" });
    }

    const buffer = file.buffer
      ? file.buffer
      : file.path
      ? await fs.promises.readFile(file.path)
      : null;

    if (!buffer) {
      return res.status(400).json({ success: false, error: "PDF is required" });
    }

    const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
    const parsed = await pdfParse(buffer);
    const rawText = (parsed?.text || "").toString();
    const text = rawText.replace(/\r\n/g, "\n").trim();

    if (text.length < 200) {
      return res.status(400).json({
        success: false,
        error: "Could not extract enough text from this PDF",
      });
    }

    // 1) Try to extract metadata with a labeled (parseable) response.
    const excerpt = text.slice(0, 28000);
    const extractionPrompt = `Extract metadata from the PDF text below.

Return ONLY these labeled blocks (no markdown, no bullets):
TITLE: <single line>
AUTHORS: <comma-separated or empty>
ABSTRACT: <1 paragraph or empty>

PDF text (truncated):
${excerpt}`;

    let title = "";
    let authors = "";
    let abstract = "";

    try {
      const extraction = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content:
              "Extract paper metadata from text. Output must follow the labeled format exactly.",
          },
          { role: "user", content: extractionPrompt },
        ],
        temperature: 0.1,
        max_tokens: 500,
      });

      const raw = (extraction.choices?.[0]?.message?.content || "").trim();
      const parsedMeta = parseLabeledPdfExtraction(raw);
      title = clampText(parsedMeta.title, 400);
      authors = clampText(parsedMeta.authors, 600);
      abstract = clampText(parsedMeta.abstract, 4000);
    } catch {
      // fall back to heuristics below
    }

    // 2) Heuristic fallback (no LLM parsing involved).
    if (!title || title === "Uploaded PDF") {
      const guessed = guessTitleAuthorsFromPdfText(text);
      if (!title) title = guessed.title;
      if (!authors) authors = guessed.authors;
    }

    if (!abstract) {
      abstract = clampText(extractAbstractFromPdfText(text), 4000);
    }

    // If we still can't find an abstract, use an excerpt as pseudo-abstract.
    if (!abstract) {
      abstract = clampText(text.slice(0, 1800).replace(/\s+/g, " "), 1800);
    }

    // 3) Use the existing, already-hardened summarizer.
    const simplifiedSummary = await simplifyPaper({ title, abstract });

    const pdfUrl = supabase
      ? await uploadPdfToSupabaseStorage({
          buffer,
          contentType: file.mimetype,
          originalName: file.originalname,
        })
      : file.filename
      ? `/uploads/${file.filename}`
      : null;

    if (!pdfUrl) {
      return res
        .status(500)
        .json({ success: false, error: "Failed to store uploaded PDF" });
    }

    res.json({
      success: true,
      data: {
        title,
        authors,
        abstract,
        published: null,
        arxivId: null,
        pdfUrl,
        simplifiedSummary,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || "Failed to process PDF",
    });
  }
});

// Saved papers APIs (per-user)
app.post("/api/papers/import", requireAuthSession(), async (req, res) => {
  if (!pool)
    return res.status(503).json({ message: "Database not configured" });
  try {
    await ensurePapersTable();
    const { arxivUrl, summary, project, tags } = req.body;
    const arxivId = extractArxivId(arxivUrl);
    const paperData = await fetchArxivPaper(arxivId);
    const mergedSummary = typeof summary === "string" ? summary : null;
    const cleanProject = typeof project === "string" ? project.trim() : null;
    const cleanTags = Array.isArray(tags)
      ? tags.map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean)
      : null;

    const insertQuery = `
      INSERT INTO papers (user_id, arxiv_id, title, authors, abstract, pdf_url, summary, project, tags)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (user_id, arxiv_id) DO UPDATE SET
        title = EXCLUDED.title,
        authors = EXCLUDED.authors,
        abstract = EXCLUDED.abstract,
        pdf_url = EXCLUDED.pdf_url,
        summary = COALESCE(EXCLUDED.summary, papers.summary),
        project = COALESCE(EXCLUDED.project, papers.project),
        tags = COALESCE(EXCLUDED.tags, papers.tags)
      RETURNING *;
    `;

    const result = await pgQuery(
      insertQuery,
      [
        req.user.id,
        arxivId,
        paperData.title,
        paperData.authors,
        paperData.abstract,
        paperData.pdfUrl,
        mergedSummary,
        cleanProject,
        cleanTags,
      ],
      "papers.import"
    );

    res.json({ success: true, paper: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to save paper" });
  }
});

app.post("/api/papers/manual", requireAuthSession(), async (req, res) => {
  if (!pool)
    return res.status(503).json({ message: "Database not configured" });
  try {
    await ensurePapersTable();

    const title = assertString(req.body?.title, "title").slice(0, 400);
    const authors =
      typeof req.body?.authors === "string"
        ? req.body.authors.trim().slice(0, 600)
        : null;
    const abstract =
      typeof req.body?.abstract === "string"
        ? req.body.abstract.trim().slice(0, 4000)
        : null;
    const pdfUrl =
      typeof req.body?.pdfUrl === "string"
        ? req.body.pdfUrl.trim().slice(0, 2000)
        : typeof req.body?.pdf_url === "string"
        ? req.body.pdf_url.trim().slice(0, 2000)
        : null;
    const summary =
      typeof req.body?.summary === "string" ? req.body.summary : null;
    const notes = typeof req.body?.notes === "string" ? req.body.notes : null;
    const project =
      typeof req.body?.project === "string" ? req.body.project.trim() : null;
    const tags = Array.isArray(req.body?.tags)
      ? req.body.tags
          .map((t) => (typeof t === "string" ? t.trim() : ""))
          .filter(Boolean)
      : null;

    const insertQuery = `
      INSERT INTO papers (user_id, arxiv_id, title, authors, abstract, pdf_url, summary, notes, project, tags)
      VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;

    const result = await pgQuery(
      insertQuery,
      [
        req.user.id,
        title,
        authors,
        abstract,
        pdfUrl,
        summary,
        notes,
        project,
        tags,
      ],
      "papers.manual"
    );

    res.json({ success: true, paper: result.rows[0] });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      message: error.message || "Failed to save paper",
    });
  }
});

app.get("/api/papers", requireAuthSession(), async (req, res) => {
  if (!pool)
    return res.status(503).json({ message: "Database not configured" });
  const search = (req.query.q || "").toString().trim();
  const values = [req.user.id];
  let where = "user_id = $1";

  if (search) {
    values.push(`%${search}%`);
    where += " AND (title ILIKE $2 OR abstract ILIKE $2 OR notes ILIKE $2)";
  }

  const query = `
    SELECT id, arxiv_id, title, authors, abstract, pdf_url, summary, notes, project, tags, created_at
    FROM papers
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT 50;
  `;

  try {
    await ensurePapersTable();
    const result = await pgQuery(query, values, "papers.list");
    res.json({ success: true, papers: result.rows });
  } catch (error) {
    res
      .status(500)
      .json({ message: error.message || "Failed to fetch papers" });
  }
});

app.get("/api/papers/:id", requireAuthSession(), async (req, res) => {
  if (!pool)
    return res.status(503).json({ message: "Database not configured" });
  try {
    await ensurePapersTable();
    const result = await pgQuery(
      `SELECT id, arxiv_id, title, authors, abstract, pdf_url, summary, notes, project, tags, qa_history, created_at
       FROM papers
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [req.params.id, req.user.id],
      "papers.get"
    );
    if (!result.rowCount) return res.status(404).json({ message: "Not found" });
    res.json({ success: true, paper: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to fetch paper" });
  }
});

app.patch("/api/papers/:id", requireAuthSession(), async (req, res) => {
  if (!pool)
    return res.status(503).json({ message: "Database not configured" });
  const { notes, title, project, tags, qa_history } = req.body;
  const fields = [];
  const values = [];

  if (typeof title === "string") {
    values.push(title.trim());
    fields.push(`title = $${values.length}`);
  }

  if (typeof notes === "string") {
    values.push(notes);
    fields.push(`notes = $${values.length}`);
  }

  if (typeof project === "string") {
    values.push(project.trim());
    fields.push(`project = $${values.length}`);
  }

  if (Array.isArray(tags)) {
    const cleanTags = tags
      .map((t) => (typeof t === "string" ? t.trim() : ""))
      .filter(Boolean);
    values.push(cleanTags);
    fields.push(`tags = $${values.length}`);
  }

  if (Array.isArray(qa_history)) {
    const cleanHistory = qa_history
      .slice(0, 100)
      .map((m) => {
        const role = m?.role === "user" ? "user" : "ai";
        const text = typeof m?.text === "string" ? m.text.slice(0, 8000) : "";
        const ts = typeof m?.ts === "number" ? m.ts : Date.now();
        return { role, text, ts };
      })
      .filter((m) => m.text);
    values.push(JSON.stringify(cleanHistory));
    fields.push(`qa_history = $${values.length}::jsonb`);
  }

  if (!fields.length) return res.status(400).json({ message: "No updates" });

  values.push(req.params.id, req.user.id);

  const query = `
    UPDATE papers
    SET ${fields.join(", ")}
    WHERE id = $${values.length - 1} AND user_id = $${values.length}
    RETURNING *;
  `;

  try {
    await ensurePapersTable();
    const result = await pgQuery(query, values, "papers.update");
    if (!result.rowCount) return res.status(404).json({ message: "Not found" });
    res.json({ success: true, paper: result.rows[0] });
  } catch (error) {
    res
      .status(500)
      .json({ message: error.message || "Failed to update paper" });
  }
});

app.delete("/api/papers/:id", requireAuthSession(), async (req, res) => {
  if (!pool)
    return res.status(503).json({ message: "Database not configured" });
  try {
    await ensurePapersTable();
    const result = await pgQuery(
      "DELETE FROM papers WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id],
      "papers.delete"
    );
    if (!result.rowCount) return res.status(404).json({ message: "Not found" });
    res.json({ success: true });
  } catch (error) {
    res
      .status(500)
      .json({ message: error.message || "Failed to delete paper" });
  }
});

// Q&A endpoints
app.post("/api/qa/live", requireAuthSession(), async (req, res) => {
  try {
    const question = assertString(req.body?.question, "question");
    const paper = req.body?.paper || {};
    const { answer, sources } = await answerQuestion({ question, paper });
    res.json({ success: true, answer, sources });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.post("/api/qa/saved/:id", requireAuthSession(), async (req, res) => {
  if (!pool)
    return res.status(503).json({ message: "Database not configured" });
  try {
    await ensurePapersTable();
    const question = assertString(req.body?.question, "question");
    const result = await pgQuery(
      `SELECT title, authors, abstract, summary FROM papers WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [req.params.id, req.user.id],
      "qa.saved.getPaper"
    );
    if (!result.rowCount) return res.status(404).json({ message: "Not found" });
    const paper = result.rows[0];
    const { answer, sources } = await answerQuestion({ question, paper });
    res.json({ success: true, answer, sources });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Paper Plain API is running",
    authEnabled: Boolean(process.env.DATABASE_URL),
  });
});

// Only start a listener in non-serverless (local dev) environments
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Paper Plain server running on http://localhost:${PORT}`);
  });
}

// Export the Express app for Vercel serverless
export { app };
