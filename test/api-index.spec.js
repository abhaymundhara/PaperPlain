import assert from "node:assert/strict";
import test from "node:test";
import handler from "../api/index.js";

function createMockRes() {
  let body = "";
  let resolve;
  const done = new Promise((r) => {
    resolve = r;
  });

  const res = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(chunk) {
      if (chunk) body += chunk.toString();
      resolve(body);
    },
  };

  return { res, done, getBody: async () => done };
}

test("/api/health responds without initializing the express app", async () => {
  const { res, getBody } = createMockRes();
  const req = { url: "/api/health" };

  await handler(req, res);

  const body = await getBody();
  const payload = JSON.parse(body);
  assert.equal(res.statusCode, 200);
  assert.equal(payload.status, "ok");
  assert.equal(payload.message, "Paper Plain API is running");
  assert.equal(payload.authEnabled, false);
});

test("non-health routes delegate to the express app", async () => {
  const { res, getBody } = createMockRes();
  const req = { url: "/api/anything" };
  const previousApp = globalThis.__PAPERPLAIN_TEST_APP__;

  globalThis.__PAPERPLAIN_TEST_APP__ = (_req, response) => {
    response.statusCode = 201;
    response.setHeader("content-type", "text/plain");
    response.end("ok");
  };

  await handler(req, res);

  const body = await getBody();
  assert.equal(res.statusCode, 201);
  assert.equal(body, "ok");

  globalThis.__PAPERPLAIN_TEST_APP__ = previousApp;
});
