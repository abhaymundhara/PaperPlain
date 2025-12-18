import serverlessHttp from "serverless-http";

let handler;

try {
  const mod = await import("../server.js");
  handler = serverlessHttp(mod.app);
} catch (e) {
  const errorId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  console.error("[vercel] failed to initialize server", { errorId });
  console.error(e);
  handler = (_req, res) => {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        message: "Server initialization failed",
        errorId,
      })
    );
  };
}

export default handler;
