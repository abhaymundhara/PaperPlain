import serverlessHttp from "serverless-http";

let cachedHandler;
let cachedInitError;

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label || "Operation"} timed out after ${ms}ms`);
      err.code = "TIMEOUT";
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function getExpressHandler() {
  if (cachedHandler) return cachedHandler;
  if (cachedInitError) throw cachedInitError;

  try {
    const mod = await withTimeout(
      import("../server.js"),
      8000,
      "Import server.js"
    );
    cachedHandler = serverlessHttp(mod.app);
    return cachedHandler;
  } catch (e) {
    cachedInitError = e;
    throw e;
  }
}

export default async function handler(req, res) {
  const url = req?.url || "";

  // Fast-path: health endpoints should not depend on Express init.
  if (url.startsWith("/api/health/db")) {
    try {
      const { dbHealthCheck, pool } = await import("../db.js");
      const ok = await withTimeout(
        Promise.resolve(dbHealthCheck()),
        6000,
        "dbHealthCheck"
      );
      return sendJson(res, 200, {
        ok: Boolean(ok),
        databaseConfigured: Boolean(pool),
      });
    } catch (e) {
      return sendJson(res, 503, {
        ok: false,
        databaseConfigured: Boolean(process.env.DATABASE_URL),
        message: e?.message || "Database check failed",
      });
    }
  }

  if (url.startsWith("/api/health")) {
    return sendJson(res, 200, {
      status: "ok",
      message: "Paper Plain API is running",
      authEnabled: Boolean(process.env.DATABASE_URL),
    });
  }

  try {
    const expressHandler = await getExpressHandler();
    return expressHandler(req, res);
  } catch (e) {
    const errorId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    console.error("[vercel] failed to initialize server", { errorId });
    console.error(e);
    return sendJson(res, 500, {
      success: false,
      message: "Server initialization failed",
      errorId,
    });
  }
}
