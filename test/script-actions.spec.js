import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const script = fs.readFileSync(
  new URL("../public/script.js", import.meta.url),
  "utf8"
);

test("script exposes export/download helpers", () => {
  assert.match(script, /function downloadPdf/);
  assert.match(script, /function toggleExportMenu/);
  assert.match(script, /function exportMarkdown/);
  assert.match(script, /function exportText/);
  assert.match(script, /function exportJson/);
  assert.match(script, /function exportBibtex/);
});

test("script includes deleteSavedPaper flow", () => {
  assert.match(script, /function deleteSavedPaper/);
  assert.match(script, /deleteSavedPaper[\s\S]*currentPaperId\s*=\s*null/);
  assert.match(script, /deleteSavedPaper[\s\S]*renderSavedList/);
});
