import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const html = fs.readFileSync(new URL("index.html", root), "utf8");
const login = fs.readFileSync(new URL("login.html", root), "utf8");
const js = fs.readFileSync(new URL("js/gestao-validadores.js", root), "utf8");
const config = fs.readFileSync(new URL("js/config.js", root), "utf8");

const targets = [...html.matchAll(/data-board-target="([^"]+)"/g)].map(match => match[1]);
assert.equal(targets.length, 7);
assert.equal(new Set(targets).size, 7);
assert.ok(!js.includes("window.open("));
assert.ok(!html.includes('target="_blank"'));

const dynamicEditorIds = new Set([
  "gvEditorName", "gvEditorPeople", "gvEditorStatus", "gvEditorDropdown",
  "gvEditorDate", "gvEditorFrom", "gvEditorTo", "gvEditorWeekStart",
  "gvEditorWeekEnd", "gvEditorCheckbox", "gvEditorRelations", "gvEditorUrl",
  "gvEditorLinkText", "gvEditorEmail", "gvEditorEmailText", "gvEditorPhone",
  "gvEditorCountry", "gvEditorNumber", "gvEditorRating", "gvEditorHour",
  "gvEditorCountryCode", "gvEditorCountryName", "gvEditorLat", "gvEditorLng",
  "gvEditorAddress", "gvEditorColor", "gvEditorTags", "gvEditorTimezone",
  "gvEditorSimple",
]);
const usedIds = [...js.matchAll(/\$\("([A-Za-z0-9_-]+)"\)/g)].map(match => match[1]);
const missing = [...new Set(usedIds)].filter(id => !dynamicEditorIds.has(id) && !html.includes(`id="${id}"`));
assert.deepEqual(missing, []);

for (const file of [html, login, config]) {
  assert.ok(file.includes("20260917-v2.0-internal-boards"));
  assert.ok(!file.includes("v1.7-real-monday-boards"));
}

for (const action of ["workspace_bootstrap", "board_data", "update_cell", "update_item_name"]) {
  assert.ok(js.includes(`\"${action}\"`));
}

console.log("static-frontend: navegação interna, controles e build V2.0 aprovados");
