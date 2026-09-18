import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const html = fs.readFileSync(new URL("index.html", root), "utf8");
const login = fs.readFileSync(new URL("login.html", root), "utf8");
const js = fs.readFileSync(new URL("js/gestao-validadores.js", root), "utf8");
const config = fs.readFileSync(new URL("js/config.js", root), "utf8");
const edge = fs.readFileSync(new URL("supabase/functions/monday-responsaveis/index.ts", root), "utf8");
const migration = fs.readFileSync(new URL("supabase/migrations/20260918_gv_auditoria.sql", root), "utf8");

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
  assert.ok(file.includes("20260918-v2.4-audit-reports"));
  assert.ok(!file.includes("v1.7-real-monday-boards"));
}

for (const action of ["workspace_bootstrap", "board_data", "board_page", "create_item", "update_cell", "update_item_name", "log_access", "audit_report"]) {
  assert.ok(js.includes(`\"${action}\"`));
  assert.ok(edge.includes(`\"${action}\"`));
}

assert.ok(html.includes('id="gvViews"'));
assert.ok(html.includes('id="gvCreateItem"'));
assert.ok(html.includes('id="gvCreateDialog"'));
assert.ok(html.includes('>Criar título</button>'));
for (const id of ["gvFiltroControl", "gvFilterGroups", "gvAddFilter", "gvAddFilterGroup", "gvApplyFilters", "gvClearFilters", "gvFilterResults"]) {
  assert.ok(html.includes(`id="${id}"`));
}
assert.ok(js.includes("activeViewId"));
assert.ok(js.includes("matchesAdvancedFilters"));
assert.ok(js.includes("filter_column_ids"));
assert.ok(js.includes("loadRemainingPages"));
assert.ok(js.includes("V2.4 · auditoria ativa"));
assert.ok(js.includes("BOOTSTRAP_CACHE_MS"));
assert.ok(js.includes("const initialLoad = loadBoard(ROOT_BOARD_ID)"));
assert.ok(!js.includes('view.type !== "FORM"'));
for (const id of [
  "gvAuditReports", "gvAuditView", "gvAuditFrom", "gvAuditTo", "gvAuditUser",
  "gvAuditAction", "gvAuditApply", "gvAuditExport", "gvAuditTable",
]) assert.ok(html.includes(`id="${id}"`));
assert.ok(js.includes("exportAuditCsv"));
assert.ok(js.includes("valor_anterior"));
assert.ok(js.includes("valor_novo"));
assert.ok(migration.includes("create table if not exists public.gv_acessos"));
assert.ok(migration.includes("create table if not exists public.gv_alteracoes"));
assert.ok(migration.includes("enable row level security"));

console.log("static-frontend: V2.4 aprovada com abertura rápida, filtros, edição, relatórios, CSV e migração de auditoria");
