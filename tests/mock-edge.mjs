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

globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes("/auth/v1/user")) {
    return Response.json({ email: "teste@animaeducacao.com.br" });
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
        { id: "text", title: "Texto", type: "text", settings: {} },
        { id: "people", title: "Pessoa", type: "people", settings: {} },
        { id: "formula", title: "Fórmula", type: "formula", settings: {} },
      ],
    }] } });
  }
  if (query.includes("items_page(limit:")) {
    return Response.json({ data: { boards: [{ items_page: {
      cursor: null,
      items: [{
        id: "100", name: "Item de teste", group: { id: "g1", title: "Grupo A" },
        column_values: [
          { id: "text", text: "Valor", value: JSON.stringify("Valor"), type: "text" },
          { id: "people", text: "Pessoa", value: JSON.stringify({ personsAndTeams: [{ id: 1, kind: "person" }] }), type: "people" },
        ],
      }],
    } }] } });
  }
  if (query.includes("columns { id title type }") && !query.includes("mutation")) {
    return Response.json({ data: { boards: [{ columns: [
      { id: "text", title: "Texto", type: "text" },
      { id: "formula", title: "Fórmula", type: "formula" },
    ] }] } });
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

const data = await call({ action: "board_data", board_id: 9433297929, column_ids: ["text", "people"] });
assert.equal(data.status, 200);
assert.equal(data.body.items[0].name, "Item de teste");
assert.deepEqual(data.body.selected_column_ids, ["text", "people"]);

const denied = await call({ action: "board_data", board_id: 1 });
assert.equal(denied.status, 403);

const readOnly = await call({ action: "update_cell", board_id: 9433297929, item_id: "100", column_id: "formula", mode: "simple", simple_value: "x" });
assert.equal(readOnly.status, 422);

const updated = await call({ action: "update_cell", board_id: 9433297929, item_id: "100", column_id: "text", mode: "simple", simple_value: "Novo" });
assert.equal(updated.status, 200);
assert.equal(updated.body.item.column_values[0].text, "Novo");

const renamed = await call({ action: "update_item_name", board_id: 9433297929, item_id: "100", name: "Novo nome" });
assert.equal(renamed.status, 200);
assert.equal(renamed.body.item.name, "Novo nome");

console.log("mock-edge: 6 cenários aprovados");
