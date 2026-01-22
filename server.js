import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import xml2js from "xml2js";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Service imports
import { fetchPaperByDOI, extractDOI, isDOI } from "./services/crossref.js";
import { fetchPaperByPMID, extractPMID, isPMID } from "./services/pubmed.js";
import { fetchPaper, searchPapers, getCitations, getReferences, getRelatedPapers, normalizePaperId, paperToSchema } from "./services/semanticscholar.js";

dotenv.config();

// Lazy imports to avoid blocking module load
let cachedDb;
let pool = null; // Exposed synchronously after first getDb() call
async function getDb() {
  if (cachedDb) return cachedDb;
  cachedDb = await import("./db.js");
  pool = cachedDb.pool; // Cache for sync access
  return cachedDb;
}

let cachedAuth;
async function getAuth() {
  if (cachedAuth !== undefined) return cachedAuth;
  const authModule = await import("./auth.js");
  cachedAuth = await authModule.getAuth();
  return cachedAuth;
}

const app = express();
const PORT = process.env.PORT || 3000;
const SKIP_AUTH = process.env.SKIP_AUTH === "true";

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

let cachedGroq;
async function getGroqClient() {
  if (cachedGroq) return cachedGroq;
  const { default: Groq } = await import("groq-sdk");
  cachedGroq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
  });
  return cachedGroq;
}

let cachedBetterAuthNode;
async function getBetterAuthNode() {
  if (cachedBetterAuthNode) return cachedBetterAuthNode;
  cachedBetterAuthNode = await import("better-auth/node");
  return cachedBetterAuthNode;
}

let cachedAPIError;
async function getAPIErrorClass() {
  if (cachedAPIError) return cachedAPIError;
  const mod = await import("better-auth/api");
  cachedAPIError = mod.APIError;
  return cachedAPIError;
}

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

// Middleware
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

// Better Auth handler (must be mounted before express.json)
app.all(
  "/api/better-auth/*",
  asyncHandler(async (req, res) => {
    const auth = await getAuth();
    if (!auth) {
      return res.status(503).json({
        message: "Auth is not configured. Set DATABASE_URL to enable it.",
      });
    }
    const { toNodeHandler } = await getBetterAuthNode();
    return toNodeHandler(auth)(req, res);
  })
);

app.use(express.json());
app.use(express.static("public"));

async function ensurePapersTable() {
  const { pool } = await getDb();
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
    const auth = await getAuth();
    if (!auth) return res.status(401).json({ message: "Sign in required" });
    try {
      const { fromNodeHeaders } = await getBetterAuthNode();
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

app.get("/api/arxiv/:id/bibtex", async (req, res) => {
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

app.get("/api/arxiv/:id/pdf", async (req, res) => {
  try {
    const arxivId = (req.params.id || "").toString().trim();
    if (!/^[0-9]{4}\.[0-9]{4,5}$/.test(arxivId)) {
      return res.status(400).json({ message: "Invalid arXiv ID" });
    }

    const url = `https://arxiv.org/pdf/${arxivId}.pdf`;
    const response = await axios.get(url, {
      responseType: "stream",
      headers: { "User-Agent": "PaperPlain/1.0" },
      timeout: 20000,
    });

    res.setHeader("content-type", "application/pdf");
    res.setHeader(
      "content-disposition",
      `attachment; filename="${arxivId}.pdf"`
    );

    response.data.pipe(res);
  } catch (error) {
    const status = error?.response?.status || 502;
    res.status(status).json({
      message: error?.message || "Failed to download PDF",
    });
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
  const { pool } = await getDb();
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
const SUMMARY_STYLES = {
  simple: {
    description: "Plain English, minimal jargon",
    maxTokens: 1000,
    systemPrompt: "You are an expert at translating complex academic papers into clear, simple English that anyone can understand.",
    promptTemplate: (title, abstract) => `You are an expert at explaining complex academic research in simple, plain English.

Paper Title: ${title}
Abstract: ${abstract}

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

Use simple language, avoid jargon, and make it accessible to someone without expertise in this field.`
  },
  detailed: {
    description: "Comprehensive with methodology depth",
    maxTokens: 1500,
    systemPrompt: "You are a research analyst providing comprehensive paper analysis.",
    promptTemplate: (title, abstract) => `Provide a detailed analysis of this academic paper.

Paper Title: ${title}
Abstract: ${abstract}

Please provide a comprehensive summary that includes:

1. RESEARCH PROBLEM: What specific problem or gap in the field does this research address? (3-4 sentences)

2. METHODOLOGY: What methods, data sources, or approaches were used? Include technical details. (4-5 sentences)

3. KEY FINDINGS: What were the main results and contributions? (3-4 sentences)

4. IMPLICATIONS: What are the practical and theoretical implications of this work? (2-3 sentences)

5. LIMITATIONS: What are the acknowledged limitations of the study? (2 sentences)

6. KEY TERMS & CONCEPTS: Define 5 important technical terms or concepts from this paper.

Format your response as follows:
**Research Problem:**
[Your explanation]

**Methodology:**
[Your explanation]

**Key Findings:**
[Your explanation]

**Implications:**
[Your explanation]

**Limitations:**
[Your explanation]

**Key Terms & Concepts:**
• **Term 1**: Definition
• **Term 2**: Definition
• **Term 3**: Definition
• **Term 4**: Definition
• **Term 5**: Definition`
  },
  technical: {
    description: "Preserve technical terminology",
    maxTokens: 1200,
    systemPrompt: "You are a domain expert providing technically accurate paper summaries.",
    promptTemplate: (title, abstract) => `Provide a technically accurate summary of this academic paper, maintaining all specialized terminology.

Paper Title: ${title}
Abstract: ${abstract}

Provide a summary that preserves technical accuracy:

1. PROBLEM STATEMENT: Technical formulation of the research problem

2. TECHNICAL APPROACH: Methodology with technical details preserved

3. RESULTS: Key findings with technical specifications

4. CONTRIBUTIONS: Original contributions to the field

5. TECHNICAL GLOSSARY: Define 5 technical terms with precise definitions

Format:
**Problem Statement:**
[Technical description]

**Technical Approach:**
[Methodology with terminology]

**Results:**
[Findings]

**Contributions:**
[List]

**Technical Glossary:**
• **Term 1**: Precise definition
• **Term 2**: Precise definition
• **Term 3**: Precise definition`
  },
  tldr: {
    description: "One-paragraph summary",
    maxTokens: 200,
    systemPrompt: "You specialize in ultra-concise summaries.",
    promptTemplate: (title, abstract) => `Provide a single-paragraph TL;DR summary of this paper.

Paper: ${title}
Abstract: ${abstract}

TL;DR: [One paragraph, 3-4 sentences maximum, covering the main point in simple terms]`
  }
};

async function simplifyPaper(paperData, style = 'simple') {
  const styleConfig = SUMMARY_STYLES[style] || SUMMARY_STYLES.simple;
  const prompt = styleConfig.promptTemplate(paperData.title, paperData.abstract);

  try {
    const groq = await getGroqClient();
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: styleConfig.systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: styleConfig.maxTokens,
    });

    let text = (completion.choices?.[0]?.message?.content || "").trim();

    // Normalize Key Terms heading for the frontend parser.
    text = text.replace(
      /^(\*\*\s*)?Key\s*Terms\s*:\s*(\*\*)?/gim,
      "**Key Terms:**"
    );

    // If the model omitted key terms and this isn't TL;DR style, add them via a small follow-up.
    if (style !== 'tldr' && !/\bKey\s*Terms\b/i.test(text)) {
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
            content: "You extract key terms and define them simply. Output must match the requested format exactly.",
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

  const groq = await getGroqClient();
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
app.post(
  "/api/auth/signup",
  asyncHandler(async (req, res) => {
    const auth = await getAuth();
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

      const { fromNodeHeaders } = await getBetterAuthNode();
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
      const APIError = await getAPIErrorClass();
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
  })
);

app.post(
  "/api/auth/signin",
  asyncHandler(async (req, res) => {
    const auth = await getAuth();
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

      const { fromNodeHeaders } = await getBetterAuthNode();
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
      const APIError = await getAPIErrorClass();
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
  })
);

app.post(
  "/api/auth/signout",
  asyncHandler(async (req, res) => {
    const auth = await getAuth();
    if (!auth) {
      return res.status(503).json({
        message: "Auth is not configured. Set DATABASE_URL to enable it.",
      });
    }
    try {
      const { fromNodeHeaders } = await getBetterAuthNode();
      const response = await auth.api.signOut({
        headers: fromNodeHeaders(req.headers),
        asResponse: true,
      });

      await pipeWebResponseToExpress(res, response);
    } catch (error) {
      const APIError = await getAPIErrorClass();
      if (error instanceof APIError) {
        return res.status(error.status).json({
          message: error.message,
        });
      }

      res.status(500).json({
        message: error?.message ?? "Failed to sign out",
      });
    }
  })
);

app.get(
  "/api/auth/me",
  asyncHandler(async (req, res) => {
    if (SKIP_AUTH) {
      return res.json({ user: { id: "dev-user", email: "dev@example.com" } });
    }
    const auth = await getAuth();
    if (!auth) {
      return res.json(null);
    }
    try {
      const { fromNodeHeaders } = await getBetterAuthNode();
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
  })
);

app.get("/api/health/db", async (_req, res) => {
  try {
    const { dbHealthCheck, pool } = await getDb();
    const ok = await withTimeout(dbHealthCheck(), 6000, "dbHealthCheck");
    res.json({ ok, databaseConfigured: Boolean(pool) });
  } catch (error) {
    const { pool } = await getDb();
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
    const { arxivUrl, style = 'simple' } = req.body;

    if (!arxivUrl) {
      return res.status(400).json({ error: "ArXiv URL is required" });
    }

    // Extract ArXiv ID
    const arxivId = extractArxivId(arxivUrl);

    // Fetch paper data
    const paperData = await fetchArxivPaper(arxivId);

    // Generate simplified summary
    const summary = await simplifyPaper(paperData, style);

    res.json({
      success: true,
      data: {
        ...paperData,
        simplifiedSummary: summary,
        style,
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

// DOI-based simplification
app.post("/api/simplify/doi", async (req, res) => {
  try {
    const { doi, style = 'simple' } = req.body;

    if (!doi) {
      return res.status(400).json({ error: "DOI is required" });
    }

    const paperData = await fetchPaperByDOI(doi);
    const summary = await simplifyPaper(paperData, style);

    res.json({
      success: true,
      data: {
        ...paperData,
        simplifiedSummary: summary,
        style,
        source: 'crossref',
      },
    });
  } catch (error) {
    console.error("DOI Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to process DOI",
    });
  }
});

// PubMed/PMID-based simplification
app.post("/api/simplify/pubmed", async (req, res) => {
  try {
    const { pmid, style = 'simple' } = req.body;

    if (!pmid) {
      return res.status(400).json({ error: "PMID is required" });
    }

    const paperData = await fetchPaperByPMID(pmid, process.env.NCBI_API_KEY);
    const summary = await simplifyPaper(paperData, style);

    res.json({
      success: true,
      data: {
        ...paperData,
        simplifiedSummary: summary,
        style,
        source: 'pubmed',
      },
    });
  } catch (error) {
    console.error("PubMed Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to process PMID",
    });
  }
});

// Semantic Scholar search
app.get("/api/semanticscholar/search", async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.trim().length < 3) {
      return res.status(400).json({ error: "Query must be at least 3 characters" });
    }

    const results = await searchPapers(q.trim(), parseInt(limit));
    
    const papers = (results.data || []).map(paperToSchema);

    res.json({
      success: true,
      data: papers,
      total: results.total || papers.length,
    });
  } catch (error) {
    console.error("Semantic Scholar Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Search failed",
    });
  }
});

// Get paper metadata from Semantic Scholar
app.get("/api/semanticscholar/paper/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const normalizedId = normalizePaperId(id);
    
    const paper = await fetchPaper(normalizedId);
    const schemaData = paperToSchema(paper);
    
    res.json({
      success: true,
      data: schemaData,
      raw: paper,
    });
  } catch (error) {
    console.error("Semantic Scholar Paper Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch paper",
    });
  }
});

// Get citations for a paper
app.get("/api/semanticscholar/paper/:id/citations", async (req, res) => {
  try {
    const { id } = req.params;
    const normalizedId = normalizePaperId(id);
    const { limit = 50 } = req.query;
    
    const citations = await getCitations(normalizedId, parseInt(limit));
    
    res.json({
      success: true,
      data: citations,
    });
  } catch (error) {
    console.error("Citations Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch citations",
    });
  }
});

// Get related papers
app.get("/api/semanticscholar/paper/:id/related", async (req, res) => {
  try {
    const { id } = req.params;
    const normalizedId = normalizePaperId(id);
    const { limit = 10 } = req.query;
    
    const related = await getRelatedPapers(normalizedId, parseInt(limit));
    const papers = related.map(paperToSchema);
    
    res.json({
      success: true,
      data: papers,
    });
  } catch (error) {
    console.error("Related Papers Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch related papers",
    });
  }
});

app.post("/api/simplify/pdf", pdfUpload.single("pdf"), async (req, res) => {
  try {
    const file = req.file;
    const { style = 'simple' } = req.body;
    
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
      const groq = await getGroqClient();
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
    const simplifiedSummary = await simplifyPaper({ title, abstract }, style);

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
        style,
        source: 'pdf',
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
  const { pool } = await getDb();
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
      INSERT INTO papers (user_id, arxiv_id, source, title, authors, abstract, pdf_url, summary, project, tags, year, citation_count)
      VALUES ($1, $2, 'arxiv', $3, $4, $5, $6, $7, $8, $9, $10, 0)
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
        paperData.published ? new Date(paperData.published).getFullYear() : null,
      ],
      "papers.import"
    );

    res.json({ success: true, paper: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to save paper" });
  }
});

app.post("/api/papers/manual", requireAuthSession(), async (req, res) => {
  const { pool } = await getDb();
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
    
    const doi = typeof req.body?.doi === "string" ? req.body.doi.trim().slice(0, 200) : null;
    const pmid = typeof req.body?.pmid === "string" ? req.body.pmid.trim().slice(0, 50) : null;
    const source = typeof req.body?.source === "string" ? req.body.source : 'manual';
    const journalName = typeof req.body?.journal === "string" ? req.body.journal.trim().slice(0, 500) : null;
    const year = typeof req.body?.year === "number" ? req.body.year : null;
    const citationCount = typeof req.body?.citationCount === "number" ? req.body.citationCount : 0;

    const insertQuery = `
      INSERT INTO papers (user_id, arxiv_id, doi, pmid, source, title, authors, abstract, pdf_url, summary, notes, project, tags, journal_name, year, citation_count)
      VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *;
    `;

    const result = await pgQuery(
      insertQuery,
      [
        req.user.id,
        doi,
        pmid,
        source,
        title,
        authors,
        abstract,
        pdfUrl,
        summary,
        notes,
        project,
        tags,
        journalName,
        year,
        citationCount,
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
  const { pool } = await getDb();
  if (!pool)
    return res.status(503).json({ message: "Database not configured" });

  const {
    q,
    author,
    project,
    tags,
    from_date,
    to_date,
    sort_by = 'created_at',
    sort_order = 'desc',
    page = 1,
    limit = 20
  } = req.query;

  const values = [req.user.id];
  let where = "user_id = $1";

  // Text search
  if (q && q.toString().trim()) {
    values.push(`%${q.toString().trim()}%`);
    where += ` AND (title ILIKE $${values.length} OR abstract ILIKE $${values.length} OR notes ILIKE $${values.length})`;
  }

  // Author filter
  if (author && author.toString().trim()) {
    values.push(`%${author.toString().trim()}%`);
    where += ` AND authors ILIKE $${values.length}`;
  }

  // Project filter
  if (project && project.toString().trim()) {
    values.push(project.toString().trim());
    where += ` AND project = $${values.length}`;
  }

  // Tags filter (comma-separated)
  if (tags) {
    const tagList = tags.toString().split(',').map(t => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      values.push(tagList);
      where += ` AND tags && $${values.length}::text[]`;
    }
  }

  // Date range
  if (from_date) {
    values.push(from_date.toString());
    where += ` AND created_at >= $${values.length}::timestamptz`;
  }

  if (to_date) {
    values.push(to_date.toString());
    where += ` AND created_at <= $${values.length}::timestamptz`;
  }

  // Sort
  const allowedSortFields = ['title', 'created_at', 'citation_count', 'year'];
  const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
  const sortDir = sort_order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const sortColumn = sortField === 'citation_count' ? 'citation_count' : sortField;

  // Pagination
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const offset = (pageNum - 1) * limitNum;

  values.push(limitNum, offset);

  const query = `
    SELECT id, arxiv_id, doi, pmid, source, title, authors, abstract, pdf_url, summary, notes, project, tags, citation_count, year, created_at
    FROM papers
    WHERE ${where}
    ORDER BY ${sortColumn} ${sortDir}
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `;

  // Get total count
  const countValues = values.slice(0, -2);
  const countQuery = `SELECT COUNT(*) as total FROM papers WHERE ${where}`;

  try {
    await ensurePapersTable();
    const result = await pgQuery(query, values, "papers.list");
    const countResult = await pgQuery(countQuery, countValues, "papers.count");
    
    const total = parseInt(countResult.rows[0]?.total || 0);
    
    res.json({
      success: true,
      papers: result.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        hasMore: offset + result.rows.length < total,
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: error.message || "Failed to fetch papers" });
  }
});

app.get("/api/papers/:id", requireAuthSession(), async (req, res) => {
  const { pool } = await getDb();
  if (!pool)
    return res.status(503).json({ message: "Database not configured" });
  try {
    await ensurePapersTable();
    const result = await pgQuery(
      `SELECT id, arxiv_id, doi, pmid, source, title, authors, abstract, pdf_url, summary, notes, project, tags, citation_count, year, qa_history, created_at
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
  const { pool } = await getDb();
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
  const { pool } = await getDb();
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

// Reading Lists
async function ensureReadingListsTable() {
  const { pool } = await getDb();
  if (!pool) return;
  
  await pgQuery(
    `CREATE TABLE IF NOT EXISTS reading_lists (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      is_public BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );`,
    [],
    "readingLists.create"
  );

  await pgQuery(
    `CREATE TABLE IF NOT EXISTS reading_list_items (
      id SERIAL PRIMARY KEY,
      list_id INTEGER REFERENCES reading_lists(id) ON DELETE CASCADE,
      paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
      notes TEXT,
      sort_order INTEGER DEFAULT 0,
      added_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(list_id, paper_id)
    );`,
    [],
    "readingListItems.create"
  );
}

app.get("/api/lists", requireAuthSession(), async (req, res) => {
  const { pool } = await getDb();
  if (!pool) return res.status(503).json({ message: "Database not configured" });
  
  try {
    await ensureReadingListsTable();
    const result = await pgQuery(
      `SELECT rl.*, COUNT(rlp.paper_id) as paper_count
       FROM reading_lists rl
       LEFT JOIN reading_list_items rlp ON rlp.list_id = rl.id
       WHERE rl.user_id = $1
       GROUP BY rl.id
       ORDER BY rl.created_at DESC`,
      [req.user.id],
      "lists.getAll"
    );
    res.json({ success: true, lists: result.rows });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to fetch lists" });
  }
});

app.post("/api/lists", requireAuthSession(), async (req, res) => {
  const { pool } = await getDb();
  if (!pool) return res.status(503).json({ message: "Database not configured" });
  
  try {
    await ensureReadingListsTable();
    const { name, description, is_public } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ message: "Name is required" });
    }
    
    const result = await pgQuery(
      `INSERT INTO reading_lists (user_id, name, description, is_public)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.user.id, name.trim(), description || null, is_public || false],
      "lists.create"
    );
    res.json({ success: true, list: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to create list" });
  }
});

app.get("/api/lists/:id", requireAuthSession(), async (req, res) => {
  const { pool } = await getDb();
  if (!pool) return res.status(503).json({ message: "Database not configured" });
  
  try {
    await ensureReadingListsTable();
    const listId = parseInt(req.params.id);
    
    const listResult = await pgQuery(
      `SELECT * FROM reading_lists WHERE id = $1 AND user_id = $2`,
      [listId, req.user.id],
      "lists.getOne"
    );
    
    if (!listResult.rowCount) {
      return res.status(404).json({ message: "List not found" });
    }
    
    const itemsResult = await pgQuery(
      `SELECT p.*, rlp.notes, rlp.sort_order, rlp.added_at
       FROM reading_list_items rlp
       JOIN papers p ON p.id = rlp.paper_id
       WHERE rlp.list_id = $1
       ORDER BY rlp.sort_order, rlp.added_at DESC`,
      [listId],
      "lists.getPapers"
    );
    
    res.json({
      success: true,
      list: listResult.rows[0],
      papers: itemsResult.rows,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to fetch list" });
  }
});

app.put("/api/lists/:id", requireAuthSession(), async (req, res) => {
  const { pool } = await getDb();
  if (!pool) return res.status(503).json({ message: "Database not configured" });
  
  try {
    await ensureReadingListsTable();
    const listId = parseInt(req.params.id);
    const { name, description, is_public } = req.body;
    
    const result = await pgQuery(
      `UPDATE reading_lists
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           is_public = COALESCE($3, is_public),
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [name, description, is_public],
      "lists.update"
    );
    
    if (!result.rowCount) return res.status(404).json({ message: "List not found" });
    res.json({ success: true, list: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to update list" });
  }
});

app.delete("/api/lists/:id", requireAuthSession(), async (req, res) => {
  const { pool } = await getDb();
  if (!pool) return res.status(503).json({ message: "Database not configured" });
  
  try {
    await ensureReadingListsTable();
    const listId = parseInt(req.params.id);
    
    const result = await pgQuery(
      "DELETE FROM reading_lists WHERE id = $1 AND user_id = $2",
      [listId, req.user.id],
      "lists.delete"
    );
    
    if (!result.rowCount) return res.status(404).json({ message: "List not found" });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to delete list" });
  }
});

app.post("/api/lists/:id/papers", requireAuthSession(), async (req, res) => {
  const { pool } = await getDb();
  if (!pool) return res.status(503).json({ message: "Database not configured" });
  
  try {
    await ensureReadingListsTable();
    const listId = parseInt(req.params.id);
    const { paper_id, notes, sort_order } = req.body;
    
    if (!paper_id) {
      return res.status(400).json({ message: "Paper ID is required" });
    }
    
    const result = await pgQuery(
      `INSERT INTO reading_list_items (list_id, paper_id, notes, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (list_id, paper_id) DO UPDATE SET notes = EXCLUDED.notes, sort_order = EXCLUDED.sort_order
       RETURNING *`,
      [listId, paper_id, notes || null, sort_order || 0],
      "lists.addPaper"
    );
    
    res.json({ success: true, item: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to add paper to list" });
  }
});

app.delete("/api/lists/:id/papers/:paperId", requireAuthSession(), async (req, res) => {
  const { pool } = await getDb();
  if (!pool) return res.status(503).json({ message: "Database not configured" });
  
  try {
    await ensureReadingListsTable();
    const listId = parseInt(req.params.id);
    const paperId = parseInt(req.params.paperId);
    
    const result = await pgQuery(
      "DELETE FROM reading_list_items WHERE list_id = $1 AND paper_id = $2",
      [listId, paperId],
      "lists.removePaper"
    );
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to remove paper from list" });
  }
});

// Citations table management
async function ensureCitationsTable() {
  const { pool } = await getDb();
  if (!pool) return;
  
  await pgQuery(
    `CREATE TABLE IF NOT EXISTS citations (
      id SERIAL PRIMARY KEY,
      paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
      cited_paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
      external_id TEXT,
      title TEXT,
      authors TEXT,
      year INTEGER,
      url TEXT,
      source TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );`,
    [],
    "citations.create"
  );

  await pgQuery(
    `CREATE INDEX IF NOT EXISTS citations_paper_id_idx ON citations(paper_id)`,
    [],
    "citations.idx1"
  );
  await pgQuery(
    `CREATE INDEX IF NOT EXISTS citations_cited_paper_id_idx ON citations(cited_paper_id)`,
    [],
    "citations.idx2"
  );
}

app.get("/api/papers/:id/citations", requireAuthSession(), async (req, res) => {
  const { pool } = await getDb();
  if (!pool) return res.status(503).json({ message: "Database not configured" });
  
  try {
    await ensureCitationsTable();
    const paperId = parseInt(req.params.id);
    
    // Check ownership
    const paperResult = await pgQuery(
      "SELECT id FROM papers WHERE id = $1 AND user_id = $2",
      [paperId, req.user.id],
      "citations.checkOwner"
    );
    
    if (!paperResult.rowCount) {
      return res.status(404).json({ message: "Paper not found" });
    }
    
    const citingResult = await pgQuery(
      `SELECT c.* FROM citations c WHERE c.paper_id = $1 ORDER BY c.year DESC LIMIT 100`,
      [paperId],
      "citations.getCiting"
    );
    
    const referencedResult = await pgQuery(
      `SELECT c.* FROM citations c WHERE c.cited_paper_id = $1 ORDER BY c.year DESC LIMIT 100`,
      [paperId],
      "citations.getReferenced"
    );
    
    res.json({
      success: true,
      data: {
        citing: citingResult.rows,
        referenced: referencedResult.rows,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to fetch citations" });
  }
});

app.post("/api/citations/fetch", requireAuthSession(), async (req, res) => {
  const { pool } = await getDb();
  if (!pool) return res.status(503).json({ message: "Database not configured" });
  
  try {
    await ensureCitationsTable();
    const { paper_id, source = 'semantic_scholar' } = req.body;
    
    if (!paper_id) {
      return res.status(400).json({ message: "Paper ID is required" });
    }
    
    // Get paper metadata
    const paperResult = await pgQuery(
      "SELECT id, semantic_scholar_id, arxiv_id, doi FROM papers WHERE id = $1 AND user_id = $2",
      [paper_id, req.user.id],
      "citations.getPaper"
    );
    
    if (!paperResult.rowCount) {
      return res.status(404).json({ message: "Paper not found" });
    }
    
    const paper = paperResult.rows[0];
    let externalId = paper.semantic_scholar_id || paper.arxiv_id || paper.doi;
    
    if (!externalId) {
      return res.status(400).json({ message: "Paper has no external ID" });
    }
    
    const citations = await getCitations(externalId);
    const references = await getReferences(externalId);
    
    // Store citations
    for (const c of citations.slice(0, 50)) {
      await pgQuery(
        `INSERT INTO citations (paper_id, cited_paper_id, external_id, title, authors, year, url, source)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [paper_id, c.paperId, c.title, c.authors?.map(a => a.name).join(', '), c.year, c.url, source],
        "citations.insertCiting"
      );
    }
    
    // Store references
    for (const r of references.slice(0, 50)) {
      await pgQuery(
        `INSERT INTO citations (paper_id, cited_paper_id, external_id, title, authors, year, url, source)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [paper_id, r.paperId, r.title, r.authors?.map(a => a.name).join(', '), r.year, r.url, source],
        "citations.insertReferenced"
      );
    }
    
    res.json({
      success: true,
      data: {
        citationsCount: citations.length,
        referencesCount: references.length,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to fetch citations" });
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
  const { pool } = await getDb();
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

// Critical Analysis Mode
app.post("/api/analyze/critical", requireAuthSession(), async (req, res) => {
  try {
    const { paper, summary, aspects } = req.body;
    
    if (!paper && !summary) {
      return res.status(400).json({ error: "Paper data or summary required" });
    }
    
    const title = paper?.title || "Unknown";
    const authors = paper?.authors || "";
    const abstract = paper?.abstract || "";
    const existingSummary = summary || paper?.summary || "";
    
    const context = `Paper Title: ${title}
Authors: ${authors}
Abstract: ${abstract}
Summary: ${existingSummary}`;
    
    const prompt = `You are a senior researcher providing critical analysis of this paper.

${context}

Provide a critical analysis covering:

**Strengths:**
• [Bullet points of what this paper does well]

**Weaknesses & Limitations:**
• [Bullet points of methodological issues, gaps, concerns]

**Methodology Assessment:**
• Comment on sample size, statistical methods, reproducibility

**Comparison to Related Work:**
• How does this compare to similar papers in the field?

**Future Directions:**
• What questions remain unanswered?

**Overall Assessment:**
• Rating: 1-10 and brief justification`;

    const groq = await getGroqClient();
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are a critical academic reviewer providing honest, constructive analysis.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.5,
      max_tokens: 1500,
    });

    const analysis = completion.choices[0].message.content;
    
    // Try to extract rating if present
    const ratingMatch = analysis.match(/rating[:\s]*(\d+(?:\.\d+)?)/i);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

    res.json({
      success: true,
      data: {
        analysis,
        rating,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to generate analysis" });
  }
});

// Follow-up suggestions
app.post("/api/analyze/suggestions", requireAuthSession(), async (req, res) => {
  try {
    const { paper, summary } = req.body;
    
    if (!paper && !summary) {
      return res.status(400).json({ error: "Paper data or summary required" });
    }
    
    const title = paper?.title || "Unknown";
    const existingSummary = summary || paper?.summary || "";
    
    const prompt = `Based on this paper summary, suggest 5 follow-up questions a researcher might ask:

Paper: ${title}
Summary: ${existingSummary}

Return as JSON array of strings (valid JSON only, no markdown):
["Question 1?", "Question 2?", "Question 3?", "Question 4?", "Question 5?"]`;

    const groq = await getGroqClient();
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You suggest relevant research questions. Output must be valid JSON array only.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 300,
    });

    let suggestions = [];
    try {
      const content = completion.choices[0].message.content;
      suggestions = JSON.parse(content);
      if (!Array.isArray(suggestions)) suggestions = [];
    } catch {
      suggestions = [];
    }

    res.json({ success: true, data: { suggestions } });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to generate suggestions" });
  }
});

// Streaming summary endpoint
app.post("/api/simplify/stream", async (req, res) => {
  const { arxivUrl, doi, pmid, pdf, style = 'simple' } = req.body;
  
  try {
    let paperData;
    
    if (arxivUrl) {
      const arxivId = extractArxivId(arxivUrl);
      paperData = await fetchArxivPaper(arxivId);
    } else if (doi) {
      paperData = await fetchPaperByDOI(doi);
    } else if (pmid) {
      paperData = await fetchPaperByPMID(pmid, process.env.NCBI_API_KEY);
    } else {
      return res.status(400).json({ error: "Source required (arxivUrl, doi, or pmid)" });
    }
    
    const styleConfig = SUMMARY_STYLES[style] || SUMMARY_STYLES.simple;
    const prompt = styleConfig.promptTemplate(paperData.title, paperData.abstract);
    
    const groq = await getGroqClient();
    const stream = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: styleConfig.systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: styleConfig.maxTokens,
      stream: true,
    });
    
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    
    // Send paper metadata first
    res.write(`data: ${JSON.stringify({ type: "metadata", data: paperData })}\n\n`);
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ type: "content", content })}\n\n`);
      }
    }
    
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (error) {
    console.error("Streaming error:", error);
    res.status(500).json({ error: error.message || "Streaming failed" });
  }
});

// Export paper in various formats
app.get("/api/papers/:id/export", requireAuthSession(), async (req, res) => {
  const { pool } = await getDb();
  if (!pool) return res.status(503).json({ message: "Database not configured" });
  
  const { format = 'bibtex' } = req.query;
  
  try {
    await ensurePapersTable();
    const result = await pgQuery(
      "SELECT * FROM papers WHERE id = $1 AND user_id = $2 LIMIT 1",
      [req.params.id, req.user.id],
      "export.getPaper"
    );
    
    if (!result.rowCount) {
      return res.status(404).json({ message: "Paper not found" });
    }
    
    const paper = result.rows[0];
    let output;
    let contentType;
    let filename;
    
    const cleanAuthor = (paper.authors || "").split(",").map(a => a.trim());
    
    switch (format.toLowerCase()) {
      case 'bibtex':
        output = generateBibTeX(paper);
        contentType = "application/x-bibtex";
        filename = `${paper.arxiv_id || paper.doi || paper.id}.bib`;
        break;
        
      case 'ris':
        output = generateRIS(paper);
        contentType = "application/x-research-info-systems";
        filename = `${paper.arxiv_id || paper.doi || paper.id}.ris`;
        break;
        
      case 'json':
        output = JSON.stringify(paper, null, 2);
        contentType = "application/json";
        filename = `${paper.arxiv_id || paper.doi || paper.id}.json`;
        break;
        
      case 'markdown':
        output = generateMarkdown(paper);
        contentType = "text/markdown";
        filename = `${paper.arxiv_id || paper.doi || paper.id}.md`;
        break;
        
      case 'csv':
        output = generateCSV(paper);
        contentType = "text/csv";
        filename = `${paper.arxiv_id || paper.doi || paper.id}.csv`;
        break;
        
      default:
        return res.status(400).json({ message: "Unsupported format" });
    }
    
    res.setHeader("Content-Type", `${contentType}; charset=utf-8`);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(output);
  } catch (error) {
    res.status(500).json({ message: error.message || "Export failed" });
  }
});

function generateBibTeX(paper) {
  const id = paper.arxiv_id || paper.doi || paper.id;
  const year = paper.year || new Date(paper.created_at).getFullYear();
  const authors = paper.authors?.split(",").map(a => a.trim()).join(" and ") || "Unknown";
  
  let type = "misc";
  if (paper.arxiv_id) type = "article";
  else if (paper.doi) type = "article";
  
  let bibtex = `@${type}{${id.replace(/[^a-zA-Z0-9]/g, "")},\n`;
  bibtex += `  title = {${paper.title}},\n`;
  bibtex += `  author = {${authors}},\n`;
  if (paper.journal_name) bibtex += `  journal = {${paper.journal_name}},\n`;
  if (year) bibtex += `  year = {${year}},\n`;
  if (paper.doi) bibtex += `  doi = {${paper.doi}},\n`;
  if (paper.abstract) bibtex += `  abstract = {${paper.abstract.replace(/[{}]/g, "")}},\n`;
  if (paper.arxiv_id) bibtex += `  eprint = {${paper.arxiv_id}},\n`;
  if (paper.pdf_url) bibtex += `  url = {${paper.pdf_url}},\n`;
  bibtex += `}`;
  
  return bibtex;
}

function generateRIS(paper) {
  let ris = "TY  - JOUR\n";
  ris += `TI  - ${paper.title}\n`;
  
  const authors = paper.authors?.split(",").map(a => a.trim()) || [];
  authors.forEach(a => {
    ris += `AU  - ${a}\n`;
  });
  
  if (paper.journal_name) ris += `JO  - ${paper.journal_name}\n`;
  if (paper.year) ris += `PY  - ${paper.year}\n`;
  if (paper.doi) ris += `DO  - ${paper.doi}\n`;
  if (paper.abstract) ris += `AB  - ${paper.abstract}\n`;
  if (paper.tags && paper.tags.length) ris += `KW  - ${paper.tags.join(", ")}\n`;
  if (paper.pdf_url) ris += `UR  - ${paper.pdf_url}\n`;
  ris += "ER  -";
  
  return ris;
}

function generateMarkdown(paper) {
  let md = `# ${paper.title}\n\n`;
  md += `**Authors:** ${paper.authors || 'Unknown'}\n\n`;
  if (paper.journal_name) md += `**Journal:** ${paper.journal_name}\n\n`;
  if (paper.year) md += `**Year:** ${paper.year}\n\n`;
  if (paper.doi) md += `**DOI:** ${paper.doi}\n\n`;
  if (paper.arxiv_id) md += `**arXiv:** ${paper.arxiv_id}\n\n`;
  md += `---\n\n`;
  md += `## Abstract\n\n${paper.abstract || 'No abstract available.'}\n\n`;
  md += `---\n\n`;
  md += `## Summary\n\n${paper.summary || 'No summary available.'}\n\n`;
  if (paper.notes) {
    md += `## Notes\n\n${paper.notes}\n\n`;
  }
  if (paper.tags && paper.tags.length) {
    md += `## Tags\n\n${paper.tags.map(t => `\`${t}\``).join(' ')}\n\n`;
  }
  return md;
}

function generateCSV(paper) {
  const headers = ["Title", "Authors", "Journal", "Year", "DOI", "arXiv ID", "Abstract", "Summary", "Tags"];
  const values = [
    `"${(paper.title || "").replace(/"/g, '""')}"`,
    `"${(paper.authors || "").replace(/"/g, '""')}"`,
    `"${(paper.journal_name || "").replace(/"/g, '""')}"`,
    paper.year || "",
    `"${(paper.doi || "").replace(/"/g, '""')}"`,
    `"${(paper.arxiv_id || "").replace(/"/g, '""')}"`,
    `"${(paper.abstract || "").replace(/"/g, '""')}"`,
    `"${(paper.summary || "").replace(/"/g, '""')}"`,
    `"${(paper.tags || []).join("; ")}"`,
  ];
  return headers.join(",") + "\n" + values.join(",");
}

// Bulk export
app.post("/api/papers/export", requireAuthSession(), async (req, res) => {
  const { pool } = await getDb();
  if (!pool) return res.status(503).json({ message: "Database not configured" });
  
  const { ids, format = 'bibtex' } = req.body;
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "Paper IDs required" });
  }
  
  try {
    await ensurePapersTable();
    const result = await pgQuery(
      `SELECT * FROM papers WHERE id = ANY($1::int[]) AND user_id = $2`,
      [ids, req.user.id],
      "export.bulk"
    );
    
    let output = "";
    
    for (const paper of result.rows) {
      switch (format.toLowerCase()) {
        case 'bibtex':
          output += generateBibTeX(paper) + "\n\n";
          break;
        case 'json':
          output += JSON.stringify(paper) + "\n";
          break;
        default:
          output += generateMarkdown(paper) + "\n---\n\n";
      }
    }
    
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="papers-export.${format === 'json' ? 'json' : format === 'bibtex' ? 'bib' : 'txt'}"`);
    res.send(output);
  } catch (error) {
    res.status(500).json({ message: error.message || "Bulk export failed" });
  }
});

// User Preferences
async function ensurePreferencesTable() {
  const { pool } = await getDb();
  if (!pool) return;
  
  await pgQuery(
    `CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      default_style TEXT DEFAULT 'simple',
      preferred_language TEXT DEFAULT 'en',
      export_format TEXT DEFAULT 'bibtex',
      theme TEXT DEFAULT 'system',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );`,
    [],
    "preferences.create"
  );
}

app.get("/api/preferences", requireAuthSession(), async (req, res) => {
  const { pool } = await getDb();
  if (!pool) return res.status(503).json({ message: "Database not configured" });
  
  try {
    await ensurePreferencesTable();
    const result = await pgQuery(
      "SELECT * FROM user_preferences WHERE user_id = $1",
      [req.user.id],
      "preferences.get"
    );
    
    if (result.rowCount) {
      res.json({ success: true, preferences: result.rows[0] });
    } else {
      // Return defaults
      res.json({
        success: true,
        preferences: {
          user_id: req.user.id,
          default_style: 'simple',
          preferred_language: 'en',
          export_format: 'bibtex',
          theme: 'system',
        },
      });
    }
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to get preferences" });
  }
});

app.put("/api/preferences", requireAuthSession(), async (req, res) => {
  const { pool } = await getDb();
  if (!pool) return res.status(503).json({ message: "Database not configured" });
  
  try {
    await ensurePreferencesTable();
    const { default_style, preferred_language, export_format, theme } = req.body;
    
    const result = await pgQuery(
      `INSERT INTO user_preferences (user_id, default_style, preferred_language, export_format, theme)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         default_style = COALESCE($2, user_preferences.default_style),
         preferred_language = COALESCE($3, user_preferences.preferred_language),
         export_format = COALESCE($4, user_preferences.export_format),
         theme = COALESCE($5, user_preferences.theme),
         updated_at = NOW()
       RETURNING *`,
      [req.user.id, default_style, preferred_language, export_format, theme],
      "preferences.update"
    );
    
    res.json({ success: true, preferences: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to update preferences" });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Paper Plain API is running [BUILD-v2]",
    authEnabled: Boolean(process.env.DATABASE_URL),
    betterAuthUrl: process.env.BETTER_AUTH_URL || "NOT_SET",
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    version: "v2.0.0",
  });
});

// New uncached health endpoint to test deployment
app.get("/api/health-fresh", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.json({
    status: "ok",
    message: "Fresh deployment test [BUILD-v2]",
    deploymentTime: new Date().toISOString(),
    lazyLoadEnabled: true,
    version: "v2.0.0",
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
