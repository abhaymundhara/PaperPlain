import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(
  new URL("../public/index.html", import.meta.url),
  "utf8"
);

test("paper meta actions include download, cite, export, and delete", () => {
  assert.ok(html.includes('id="paperPdfLink"'));
  assert.ok(html.includes('onclick="downloadPdf()"'));
  assert.ok(html.includes('onclick="copyCitation()"'));
  assert.ok(html.includes('id="paperDeleteBtn"'));
  assert.ok(html.includes('onclick="deleteSavedPaper()"'));
});

test("export menu includes multiple formats", () => {
  assert.ok(html.includes('onclick="exportMarkdown()"'));
  assert.ok(html.includes('onclick="exportText()"'));
  assert.ok(html.includes('onclick="exportJson()"'));
  assert.ok(html.includes('onclick="exportBibtex()"'));
});
