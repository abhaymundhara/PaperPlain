import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const script = fs.readFileSync(
  new URL("../public/script.js", import.meta.url),
  "utf8"
);

test("citation requests bypass cache", () => {
  assert.match(script, /copyCitation[\s\S]*cache:\s*["']no-store["']/);
  assert.match(script, /exportBibtex[\s\S]*cache:\s*["']no-store["']/);
  assert.match(script, /exportMarkdown[\s\S]*cache:\s*["']no-store["']/);
});
