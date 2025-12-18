import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import xml2js from "xml2js";
import Groq from "groq-sdk";
import { APIError } from "better-auth/api";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

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
if (auth) {
  app.all("/api/better-auth/*", toNodeHandler(auth));
} else {
  app.all("/api/better-auth/*", (_req, res) => {
    res.status(503).json({
      message: "Auth is not configured. Set DATABASE_URL to enable it.",
    });
  });
}

app.use(express.json());
app.use(express.static("public"));

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

    return completion.choices[0].message.content;
  } catch (error) {
    throw new Error(`Failed to generate summary: ${error.message}`);
  }
}

// Auth wrapper routes (vanilla JS frontend; Better Auth remains mounted separately)
app.post("/api/auth/signup", async (req, res) => {
  if (!auth) {
    return res.status(503).json({
      message: "Auth is not configured. Set DATABASE_URL to enable it.",
    });
  }
  try {
    const name = assertString(req.body?.name, "name");
    const email = assertString(req.body?.email, "email");
    const password = assertString(req.body?.password, "password");

    const response = await auth.api.signUpEmail({
      headers: fromNodeHeaders(req.headers),
      body: {
        name,
        email,
        password,
      },
      asResponse: true,
    });

    await pipeWebResponseToExpress(res, response);
  } catch (error) {
    if (error instanceof APIError) {
      return res.status(error.status).json({
        message: error.message,
      });
    }

    const statusCode = error?.statusCode ?? 500;
    res.status(statusCode).json({
      message: error?.message ?? "Failed to sign up",
    });
  }
});

app.post("/api/auth/signin", async (req, res) => {
  if (!auth) {
    return res.status(503).json({
      message: "Auth is not configured. Set DATABASE_URL to enable it.",
    });
  }
  try {
    const email = assertString(req.body?.email, "email");
    const password = assertString(req.body?.password, "password");

    const response = await auth.api.signInEmail({
      headers: fromNodeHeaders(req.headers),
      body: {
        email,
        password,
        rememberMe: true,
      },
      asResponse: true,
    });

    await pipeWebResponseToExpress(res, response);
  } catch (error) {
    if (error instanceof APIError) {
      return res.status(error.status).json({
        message: error.message,
      });
    }

    const statusCode = error?.statusCode ?? 500;
    res.status(statusCode).json({
      message: error?.message ?? "Failed to sign in",
    });
  }
});

app.post("/api/auth/signout", async (req, res) => {
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
  if (!auth) {
    return res.json(null);
  }
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    res.json(session);
  } catch (error) {
    res.status(500).json({
      message: error?.message ?? "Failed to get session",
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

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Paper Plain API is running",
    authEnabled: Boolean(auth),
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
