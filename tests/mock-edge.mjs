import assert from "node:assert/strict";

let handler;
globalThis.Deno = {
  env: {
    get(name) {
      return {
        MONDAY_API_VERSION: "2026-07",
        MONDAY_API_TOKEN: "test-token",
        MONDAY_VALIDACAO_BOARD_ID: "9433297929",
        SUPABASE_URL: "https://supabase.test",
        SUPABASE_ANON_KEY: "test-anon",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
      }[name];
    },
  },
  serve(callback) { handler = callback; },
};

const boardNames = [
  "Oferta para Produção",
  "Contratação Conteudista",
  "Esteira de Produção",
  "Validação de Materiais",
  "Avaliação da Atuação",
  "Critérios de Avaliação",
  "Painéis de validação",
];
const boards = boardNames.map((name, index) => ({
  id: index === 3 ? "9433297929" : String(9433297900 + index),
  name,
  url: `https://monday.test/boards/${index}`,
  workspace_id: "77",
  items_count: 1,
}));
const itemPageParams = [];
const itemQueries = [];
const auditAccessRows = [];
const auditChangeRows = [];

function storedAuditRow(body, rows) {
  const row = typeof body === "string" ? JSON.parse(body) : body;
  return { id: rows.length + 1, criado_em: new Date(Date.now() + rows.length).toISOString(), ...row };
}

globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes("/auth/v1/user")) {
    return Response.json({
      id: "user-1",
      email: "teste@animaeducacao.com.br",
      user_metadata: { full_name: "Pessoa Teste" },
    });
  }
  if (String(url).includes("/rest/v1/gv_acessos")) {
    if (String(options.method || "GET").toUpperCase() === "POST") {
      auditAccessRows.push(storedAuditRow(options.body, auditAccessRows));
      return new Response(null, { status: 201 });
    }
    return Response.json(auditAccessRows.slice().reverse());
  }
  if (String(url).includes("/rest/v1/gv_alteracoes")) {
    if (String(options.method || "GET").toUpperCase() === "POST") {
      auditChangeRows.push(storedAuditRow(options.body, auditChangeRows));
      return new Response(null, { status: 201 });
    }
    return Response.json(auditChangeRows.slice().reverse());
  }
  const request = JSON.parse(options.body || "{}");
  const query = request.query || "";

  if (query.includes("identification-impossible")) return Response.json({ errors: [{ message: "bad" }] });
  if (query.includes("users(limit:")) return Response.json({ data: { users: [{ id: "1", name: "Pessoa", email: "pessoa@animaeducacao.com.br" }] } });
  if (query.includes("boards(limit:")) return Response.json({ data: { boards } });
  if (query.includes("id name url workspace_id") && !query.includes("groups")) {
    return Response.json({ data: { boards: [boards[3]] } });
  }
  if (query.includes("groups { id title }") && query.includes("items_count")) {
    return Response.json({ data: { boards: [{
      ...boards[3],
      groups: [{ id: "g1", title: "Grupo A" }],
      columns: [
        { id: "uc", title: "Nome da UC", type: "text", settings: {} },
        { id: "ua", title: "Nome da UA", type: "text", settings: {} },
        { id: "lote", title: "Lote", type: "text", settings: {} },
        { id: "text", title: "Texto", type: "text", settings: {} },
        { id: "people", title: "Pessoa", type: "people", settings: {} },
        { id: "formula", title: "Fórmula", type: "formula", settings: {} },
      ],
      views: [
        { id: "v0", name: "Quadro principal", type: "TableBoardView", filter: null, sort: [] },
        { id: "v1", name: "26.1 SET/25 a DEZ/25", type: "TableBoardView", filter: { operator: "AND", groups: [{ operator: "AND", rules: [{ column_id: "text", compare_value: ["Valor"], compare_attribute: "", operator: "ANY_OF" }] }] }, sort: [{ column_id: "name", direction: "ASC" }] },
        { id: "v2", name: "Gráfico", type: "GraphBoardView", filter: null, sort: [{ column_id: "text", direction: "DESC" }] },
        { id: "v3", name: "Formulário", type: "FormBoardView", filter: { rules: [{ column_id: "text", compare_value: ["Valor"], operator: "CONTAINS_TEXT" }], operator: "OR" }, sort: [] },
      ],
    }] } });
  }
  if (query.includes("groups { id title }") && !query.includes("items_count")) {
    return Response.json({ data: { boards: [{ id: boards[3].id, name: boards[3].name, groups: [{ id: "g1", title: "Grupo A" }] }] } });
  }
  if (query.includes("items_page(limit:")) {
    itemPageParams.push(request.variables.queryParams ?? null);
    itemQueries.push(query);
    return Response.json({ data: { boards: [{ items_page: {
      cursor: "cursor-1",
      items: [{
        id: "100", name: "Item de teste", group: { id: "g1", title: "Grupo A" },
        column_values: [
          { id: "uc", text: "UC Teste", value: JSON.stringify("UC Teste"), type: "text" },
          { id: "ua", text: "UA Teste", value: JSON.stringify("UA Teste"), type: "text" },
          { id: "lote", text: "Lote 2", value: JSON.stringify("Lote 2"), type: "text" },
          { id: "text", text: "Valor", value: JSON.stringify("Valor"), type: "text" },
          { id: "people", text: "Pessoa", value: JSON.stringify({ personsAndTeams: [{ id: 1, kind: "person" }] }), type: "people" },
        ],
      }],
    } }] } });
  }
  if (query.includes("next_items_page(")) {
    itemQueries.push(query);
    return Response.json({ data: { next_items_page: {
      cursor: null,
      items: [{
        id: "101", name: "Segundo item", group: { id: "g1", title: "Grupo A" },
        column_values: [{ id: "text", text: "Outro", value: JSON.stringify("Outro"), type: "text" }],
      }],
    } } });
  }
  if (query.includes("columns { id title type }") && !query.includes("mutation")) {
    return Response.json({ data: {
      boards: [{ id: boards[3].id, name: boards[3].name, columns: [
        { id: "text", title: "Texto", type: "text" },
        { id: "formula", title: "Fórmula", type: "formula" },
      ] }],
      items: [{
        id: "100", name: "Item de teste", group: { id: "g1", title: "Grupo A" },
        column_values: [{ id: "text", text: "Valor anterior", value: JSON.stringify("Valor anterior"), type: "text" }],
      }],
    } });
  }
  if (query.includes("items(ids: $itemIds)") && !query.includes("columns")) {
    return Response.json({ data: {
      boards: [{ id: boards[3].id, name: boards[3].name }],
      items: [{ id: "100", name: "Item de teste", group: { id: "g1", title: "Grupo A" } }],
    } });
  }
  if (query.includes("create_item(")) {
    return Response.json({ data: { create_item: {
      id: "101", name: request.variables.itemName,
      group: { id: request.variables.groupId, title: "Grupo A" },
    } } });
  }
  if (query.includes("change_multiple_column_values")) {
    return Response.json({ data: { change_multiple_column_values: { id: "100", name: "Item de teste", column_values: [{ id: "people", text: "Pessoa", value: "{}", type: "people" }] } } });
  }
  if (query.includes("change_simple_column_value") && query.includes('column_id: "name"')) {
    return Response.json({ data: { change_simple_column_value: { id: "100", name: request.variables.value } } });
  }
  if (query.includes("change_simple_column_value")) {
    return Response.json({ data: { change_simple_column_value: { id: "100", name: "Item de teste", column_values: [{ id: "text", text: request.variables.value, value: JSON.stringify(request.variables.value), type: "text" }] } } });
  }
  throw new Error(`Consulta não simulada: ${query}`);
};

await import("../supabase/functions/monday-responsaveis/index.ts");
assert.equal(typeof handler, "function");

async function call(body) {
  const response = await handler(new Request("https://edge.test", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer session" },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

const bootstrap = await call({ action: "workspace_bootstrap" });
assert.equal(bootstrap.status, 200);
assert.equal(bootstrap.body.boards.length, 7);
assert.equal(bootstrap.body.missing_targets.length, 0);
assert.equal(bootstrap.body.diagnostics.boards_scanned, 7);
assert.equal(bootstrap.body.boards.find(board => board.name === "Contratação Conteudista").menu_target, "Contratação Conteudista");

const logged = await call({
  action: "log_access", event_type: "acesso_sistema", board_id: 9433297929,
  board_name: "Validação de Materiais", page: "/index.html", build_id: "teste-v2.4",
});
assert.equal(logged.status, 200);
assert.equal(logged.body.audit_saved, true);
assert.equal(auditAccessRows[0].usuario_email, "teste@animaeducacao.com.br");

const data = await call({ action: "board_data", board_id: 9433297929, column_ids: ["text", "people"] });
assert.equal(data.status, 200);
assert.equal(data.body.items[0].name, "Item de teste");
assert.deepEqual(data.body.selected_column_ids, ["uc", "ua", "lote", "text", "people"]);
assert.deepEqual(data.body.context_column_ids, ["uc", "ua", "lote"]);
assert.equal(data.body.views.length, 4);
assert.equal(data.body.next_cursor, "cursor-1");
assert.equal(data.body.diagnostics.progressive, true);
assert.ok(itemQueries.at(-1).includes("items_page(limit: 100"));

const hiddenFilter = await call({ action: "board_data", board_id: 9433297929, column_ids: ["text"], filter_column_ids: ["people"] });
assert.equal(hiddenFilter.status, 200);
assert.deepEqual(hiddenFilter.body.selected_column_ids, ["uc", "ua", "lote", "text"]);
assert.deepEqual(hiddenFilter.body.loaded_filter_column_ids, ["people"]);
assert.ok(itemQueries.at(-1).includes('"uc","ua","lote","text","people"'));

const nextPage = await call({ action: "board_page", board_id: 9433297929, cursor: "cursor-1", column_ids: ["text"], filter_column_ids: ["people"] });
assert.equal(nextPage.status, 200);
assert.equal(nextPage.body.items[0].name, "Segundo item");
assert.equal(nextPage.body.next_cursor, null);
assert.ok(itemQueries.at(-1).includes('"text","people"'));
assert.ok(itemQueries.at(-1).includes("next_items_page(cursor: $cursor, limit: 500"));

const savedView = await call({ action: "board_data", board_id: 9433297929, column_ids: ["text"], view_id: "v1" });
assert.equal(savedView.status, 200);
assert.equal(savedView.body.active_view_id, "v1");
assert.equal(savedView.body.items.length, 1);
assert.deepEqual(itemPageParams.at(-1), {
  operator: "and",
  groups: [{ operator: "and", rules: [{ column_id: "text", compare_value: ["Valor"], operator: "any_of" }] }],
  order_by: [{ column_id: "name", direction: "asc" }],
});

const graphView = await call({ action: "board_data", board_id: 9433297929, column_ids: ["text"], view_id: "v2" });
assert.equal(graphView.status, 200);
assert.deepEqual(itemPageParams.at(-1), { order_by: [{ column_id: "text", direction: "desc" }] });

const formView = await call({ action: "board_data", board_id: 9433297929, column_ids: ["text"], view_id: "v3" });
assert.equal(formView.status, 200);
assert.deepEqual(itemPageParams.at(-1), {
  operator: "or",
  rules: [{ column_id: "text", compare_value: ["Valor"], operator: "contains_text" }],
});

const missingView = await call({ action: "board_data", board_id: 9433297929, view_id: "inexistente" });
assert.equal(missingView.status, 404);

const denied = await call({ action: "board_data", board_id: 1 });
assert.equal(denied.status, 403);

const created = await call({ action: "create_item", board_id: 9433297929, group_id: "g1", item_name: "Novo título" });
assert.equal(created.status, 200);
assert.equal(created.body.item.name, "Novo título");
assert.equal(created.body.item.group.id, "g1");
assert.equal(created.body.audit_saved, true);
assert.equal(auditChangeRows.at(-1).acao, "criar_item");

const invalidGroup = await call({ action: "create_item", board_id: 9433297929, group_id: "g9", item_name: "Não criar" });
assert.equal(invalidGroup.status, 404);

const readOnly = await call({ action: "update_cell", board_id: 9433297929, item_id: "100", column_id: "formula", mode: "simple", simple_value: "x" });
assert.equal(readOnly.status, 422);

const updated = await call({ action: "update_cell", board_id: 9433297929, item_id: "100", column_id: "text", mode: "simple", simple_value: "Novo" });
assert.equal(updated.status, 200);
assert.equal(updated.body.item.column_values[0].text, "Novo");
assert.equal(updated.body.audit_saved, true);
assert.equal(auditChangeRows.at(-1).valor_anterior.text, "Valor anterior");
assert.equal(auditChangeRows.at(-1).valor_novo.text, "Novo");

const renamed = await call({ action: "update_item_name", board_id: 9433297929, item_id: "100", name: "Novo nome" });
assert.equal(renamed.status, 200);
assert.equal(renamed.body.item.name, "Novo nome");
assert.equal(renamed.body.audit_saved, true);
assert.equal(auditChangeRows.at(-1).valor_anterior.text, "Item de teste");

const report = await call({ action: "audit_report", from: "2020-01-01T00:00:00.000Z", to: "2030-01-01T00:00:00.000Z" });
assert.equal(report.status, 200);
assert.equal(report.body.accesses.length, 1);
assert.equal(report.body.changes.length, 5);
assert.equal(report.body.changes[0].usuario_nome, "Pessoa Teste");

console.log("mock-edge: 16 cenários aprovados, incluindo paginação, criação, auditoria de acesso, valores anterior/novo e relatório");
