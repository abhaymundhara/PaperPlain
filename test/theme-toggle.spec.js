import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(
  new URL("../public/index.html", import.meta.url),
  "utf8"
);

test("dark theme toggle removed but warm toggle remains", () => {
  assert.equal(html.includes("themeToggleBtn"), false);
  assert.equal(html.includes("warmToggleBtn"), true);
});
