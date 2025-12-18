import serverlessHttp from "serverless-http";
import { app } from "../server.js";

// Wrap Express app for Vercel serverless runtime
const handler = serverlessHttp(app);

export default handler;
