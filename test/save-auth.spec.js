import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const script = fs.readFileSync(
  new URL("../public/script.js", import.meta.url),
  "utf8"
);

test("apiRequest exposes response status on errors", () => {
  assert.match(script, /error\.status\s*=\s*response\.status/);
});

test("auth-required handler opens auth panel", () => {
  assert.match(script, /function handleAuthRequired/);
  assert.match(script, /function openAuthPanel/);
  assert.match(script, /handleAuthRequired[\s\S]*?status\s*===\s*401/);
  assert.match(script, /handleAuthRequired[\s\S]*?openAuthPanel\(/);
});

test("savePaper routes auth errors to handler", () => {
  assert.match(script, /savePaper[\s\S]*?handleAuthRequired\(error\)/);
});
