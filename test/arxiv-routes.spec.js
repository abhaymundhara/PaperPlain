import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const server = fs.readFileSync(
  new URL("../server.js", import.meta.url),
  "utf8"
);

test("bibtex endpoint does not require auth", () => {
  assert.match(
    server,
    /app\.get\(\"\/api\/arxiv\/:id\/bibtex\",\s*async\s*\(req,\s*res\)\s*=>/
  );
});

test("pdf download endpoint exists", () => {
  assert.match(server, /app\.get\(\"\/api\/arxiv\/:id\/pdf\"/);
});
