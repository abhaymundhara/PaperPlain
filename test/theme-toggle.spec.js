import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(
  new URL("../public/index.html", import.meta.url),
  "utf8"
);

test("theme toggles are present in the header", () => {
  assert.ok(html.includes("themeToggleBtn"));
  assert.ok(html.includes("warmToggleBtn"));
});
