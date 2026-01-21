import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(
  new URL("../public/index.html", import.meta.url),
  "utf8"
);

test("header uses avatar menu with settings dropdown", () => {
  assert.ok(html.includes("userMenuButton"));
  assert.ok(html.includes("userMenuDropdown"));
  assert.ok(html.includes("userMenuSettings"));
  assert.ok(html.includes("userMenuSignOut"));
  assert.ok(html.includes("settingsOverlay"));
  assert.equal(html.includes("signOutBtn"), false);
  assert.equal(html.includes("avatarLabel"), false);
});
