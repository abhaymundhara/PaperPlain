import serverlessHttp from "serverless-http";

let handler;

try {
  const mod = await import("../server.js");
  handler = serverlessHttp(mod.app);
} catch (e) {
  console.error("[vercel] failed to initialize server:", e);
  handler = (_req, res) => {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        message: "Server initialization failed",
      })
    );
  };
}

export default handler;
