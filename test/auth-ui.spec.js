import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(
  new URL("../public/index.html", import.meta.url),
  "utf8"
);

test("auth modal only offers Google sign-in", () => {
  assert.ok(html.includes("googleSignInBtn"));
  assert.ok(html.includes("Continue with Google"));
  assert.equal(html.includes("authEmail"), false);
  assert.equal(html.includes("authPassword"), false);
  assert.equal(html.includes("tabSignIn"), false);
  assert.equal(html.includes("tabSignUp"), false);
});
