const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MONDAY_URL = "https://api.monday.com/v2";
const API_VERSION = "2026-07";
const DEFAULT_BOARD_ID = 9433297929;
const GESTOR_TITLES = ["Gestor de Validação - NQ", "Gestor de Validação", "Gestor Validacao - NQ"];
const REVISOR_TITLES = ["Revisor Validador", "Revisor de Validação", "Revisor Validacao"];
const ALLOWED_DOMAINS = ["animaeducacao.com.br"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function norm(v: unknown) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function validateUser(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new Error("Sessão não informada.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !anonKey) throw new Error("Configuração de autenticação do Supabase indisponível.");

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: anonKey },
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.email) throw new Error("Sessão inválida ou expirada.");

  const domain = String(user.email).toLowerCase().split("@").pop();
  if (!ALLOWED_DOMAINS.includes(domain)) throw new Error("Usuário não autorizado para esta operação.");
  return user;
}

async function monday(query: string, variables: Record<string, unknown> = {}) {
  const token = Deno.env.get("MONDAY_API_TOKEN");
  if (!token) throw new Error("Secret MONDAY_API_TOKEN não configurado no Supabase.");

  const response = await fetch(MONDAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": token,
      "API-Version": API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (!response.ok || payload?.errors?.length) {
    const detail = payload?.errors?.map((x: any) => x.message).join(" | ") || `HTTP ${response.status}`;
    throw new Error(`Monday API: ${detail}`);
  }
  return payload.data;
}

function findColumn(columns: any[], titles: string[]) {
  const wanted = titles.map(norm);
  return columns.find(c => wanted.includes(norm(c.title))) ||
    columns.find(c => wanted.some(t => norm(c.title).includes(t) || t.includes(norm(c.title))));
}

function peopleFromValue(cv: any) {
  const list = cv?.persons_and_teams || [];
  return list.map((p: any) => ({ id: String(p.id), kind: p.kind || "person" }));
}

async function bootstrap(boardId: number) {
  const metaQuery = `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        id
        name
        columns { id title type }
      }
      users(limit: 1000) { id name email }
    }
  `;

  const meta = await monday(metaQuery, { boardId: [String(boardId)] });
  const board = meta?.boards?.[0];
  if (!board) throw new Error(`Board ${boardId} não encontrado ou sem permissão.`);

  const gestorCol = findColumn(board.columns || [], GESTOR_TITLES);
  const revisorCol = findColumn(board.columns || [], REVISOR_TITLES);
  if (!gestorCol || !revisorCol) {
    const nomes = (board.columns || []).map((c: any) => c.title).join(", ");
    throw new Error(`Não localizei as duas colunas de responsáveis. Colunas disponíveis: ${nomes}`);
  }
  if (gestorCol.type !== "people" || revisorCol.type !== "people") {
    throw new Error(`As colunas precisam ser do tipo Pessoas no Monday. Gestor=${gestorCol.type}; Revisor=${revisorCol.type}.`);
  }

  const ids = [gestorCol.id, revisorCol.id]
    .map((id: string) => `\"${id.replace(/[^a-zA-Z0-9_]/g, "")}\"`)
    .join(",");

  const fragment = `
    cursor
    items {
      id
      name
      group { id title }
      column_values(ids: [${ids}]) {
        id
        text
        ... on PeopleValue { persons_and_teams { id kind } }
      }
    }
  `;

  const firstQuery = `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) { items_page(limit: 500) { ${fragment} } }
    }
  `;

  const first = await monday(firstQuery, { boardId: [String(boardId)] });
  let page = first?.boards?.[0]?.items_page;
  const items: any[] = [...(page?.items || [])];
  let cursor = page?.cursor || null;
  let guard = 0;

  while (cursor && guard < 20) {
    const nextQuery = `query ($cursor: String!) { next_items_page(cursor: $cursor, limit: 500) { ${fragment} } }`;
    const next = await monday(nextQuery, { cursor });
    page = next?.next_items_page;
    items.push(...(page?.items || []));
    cursor = page?.cursor || null;
    guard++;
  }

  const normalizedItems = items.map(item => {
    const byId = Object.fromEntries((item.column_values || []).map((cv: any) => [cv.id, cv]));
    const gestor = byId[gestorCol.id];
    const revisor = byId[revisorCol.id];
    return {
      id: String(item.id),
      name: item.name,
      group_id: item.group?.id || null,
      group_title: item.group?.title || "Sem grupo",
      gestor_text: gestor?.text || "",
      gestor_people: peopleFromValue(gestor),
      revisor_text: revisor?.text || "",
      revisor_people: peopleFromValue(revisor),
    };
  });

  return {
    ok: true,
    board: { id: String(board.id), name: board.name },
    columns: {
      gestor: { id: gestorCol.id, title: gestorCol.title },
      revisor: { id: revisorCol.id, title: revisorCol.title },
    },
    users: (meta?.users || []).map((u: any) => ({ id: String(u.id), name: u.name, email: u.email || "" })),
    items: normalizedItems,
  };
}

async function updateResponsaveis(boardId: number, body: any) {
  const itemId = String(body?.item_id || "").trim();
  const gestorColumnId = String(body?.gestor_column_id || "").replace(/[^a-zA-Z0-9_]/g, "");
  const revisorColumnId = String(body?.revisor_column_id || "").replace(/[^a-zA-Z0-9_]/g, "");
  if (!itemId || !gestorColumnId || !revisorColumnId) throw new Error("Item e IDs das colunas são obrigatórios.");

  const makePeople = (id: unknown) => {
    const value = String(id ?? "").trim();
    return value ? { personsAndTeams: [{ id: Number(value), kind: "person" }] } : null;
  };

  const columnValues: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body, "gestor_user_id")) columnValues[gestorColumnId] = makePeople(body.gestor_user_id);
  if (Object.prototype.hasOwnProperty.call(body, "revisor_user_id")) columnValues[revisorColumnId] = makePeople(body.revisor_user_id);
  if (!Object.keys(columnValues).length) throw new Error("Nenhuma alteração foi informada.");

  const mutation = `
    mutation ($boardId: ID!, $itemId: ID!, $values: JSON!) {
      change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $values) {
        id
        name
        column_values(ids: ["${gestorColumnId}", "${revisorColumnId}"]) {
          id
          text
          ... on PeopleValue { persons_and_teams { id kind } }
        }
      }
    }
  `;

  const data = await monday(mutation, {
    boardId: String(boardId),
    itemId,
    values: JSON.stringify(columnValues),
  });

  return { ok: true, item: data?.change_multiple_column_values };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);

  try {
    await validateUser(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "bootstrap");
    const boardId = Number(body?.board_id || Deno.env.get("MONDAY_VALIDACAO_BOARD_ID") || DEFAULT_BOARD_ID);
    if (!Number.isFinite(boardId)) throw new Error("Board ID inválido.");

    if (action === "bootstrap") return json(await bootstrap(boardId));
    if (action === "update") return json(await updateResponsaveis(boardId, body));
    return json({ ok: false, error: "Ação inválida." }, 400);
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    const unauthorized = /sessão|autorizado/i.test(message);
    return json({ ok: false, error: message }, unauthorized ? 401 : 500);
  }
});
