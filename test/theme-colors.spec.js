import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync(
  new URL("../public/styles.css", import.meta.url),
  "utf8"
);

function extractBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "m");
  const match = css.match(pattern);
  return match ? match[1] : "";
}

function expectVar(block, name, value) {
  const pattern = new RegExp(`\\s${name}:\\s*${value}\\s*;`);
  assert.ok(
    pattern.test(block),
    `Expected ${name} to be ${value} in block, got: ${block.trim()}`
  );
}

test("dark theme uses near-black base", () => {
  const block = extractBlock('html[data-theme="dark"]');
  expectVar(block, "--bg-app", "#0b0b0b");
  expectVar(block, "--bg-subtle", "#111111");
  expectVar(block, "--bg-panel", "#141414");
});

test("warm dark theme uses grey base", () => {
  const block = extractBlock('html[data-theme="dark"][data-warm="on"]');
  expectVar(block, "--bg-app", "#2a2a2a");
  expectVar(block, "--bg-subtle", "#2f2f2f");
  expectVar(block, "--bg-panel", "#333333");
});
