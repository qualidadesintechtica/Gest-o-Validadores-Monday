const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MONDAY_URL = "https://api.monday.com/v2";
const API_VERSION = Deno.env.get("MONDAY_API_VERSION") || "2026-07";
const DEFAULT_BOARD_ID = 9433297929;
const GESTOR_TITLES = ["Gestor de Validação - NQ", "Gestor de Validação", "Gestor Validacao - NQ"];
const REVISOR_TITLES = ["Revisor Validador", "Revisor de Validação", "Revisor Validacao"];
const ALLOWED_DOMAINS = ["animaeducacao.com.br"];

class AppError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = "INTEGRATION_ERROR") {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
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
  if (!auth.startsWith("Bearer ")) {
    throw new AppError("Sessão não informada.", 401, "AUTH_MISSING");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !anonKey) {
    throw new AppError(
      "Configuração de autenticação do Supabase indisponível.",
      500,
      "SUPABASE_CONFIG_MISSING",
    );
  }

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: auth, apikey: anonKey },
    });
  } catch (error) {
    console.error("Falha ao validar sessão no Supabase", error);
    throw new AppError("Não foi possível validar sua sessão.", 502, "SUPABASE_AUTH_UNAVAILABLE");
  }

  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.email) {
    throw new AppError("Sessão inválida ou expirada.", 401, "AUTH_INVALID");
  }

  const domain = String(user.email).toLowerCase().split("@").pop();
  if (!ALLOWED_DOMAINS.includes(domain)) {
    throw new AppError("Usuário não autorizado para esta operação.", 403, "DOMAIN_NOT_ALLOWED");
  }

  return user;
}

function mondayErrorMessage(payload: any, response: Response, stage: string) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const details = errors.map((item: any) => {
    const message = String(item?.message || "").trim();
    const code = String(item?.extensions?.code || item?.extensions?.error_code || "").trim();
    return [code, message].filter(Boolean).join(": ");
  }).filter(Boolean);

  const requestId = response.headers.get("x-request-id") || response.headers.get("x-amzn-trace-id") || "";
  let detail = details.join(" | ") || `HTTP ${response.status}`;

  if (/^[a-f0-9]{48,}$/i.test(detail)) {
    detail = `falha interna (referência ${detail.slice(0, 12)}…)`;
  }

  const suffix = requestId ? ` · requisição ${requestId}` : "";
  return `Monday API — ${stage}: ${detail}${suffix}`;
}

async function monday(query: string, variables: Record<string, unknown> = {}, stage = "consulta") {
  const token = Deno.env.get("MONDAY_API_TOKEN");
  if (!token) {
    throw new AppError(
      "Secret MONDAY_API_TOKEN não configurado no Supabase.",
      500,
      "MONDAY_TOKEN_MISSING",
    );
  }

  let response: Response;
  try {
    response = await fetch(MONDAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": token,
        "API-Version": API_VERSION,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    console.error(`Falha de rede no Monday durante ${stage}`, error);
    throw new AppError(
      `Não foi possível acessar a API do Monday durante ${stage}.`,
      502,
      "MONDAY_UNAVAILABLE",
    );
  }

  const raw = await response.text();
  let payload: any = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error(`Resposta inválida do Monday durante ${stage}`, { status: response.status, error });
    throw new AppError(
      `Monday API — ${stage}: resposta inválida (HTTP ${response.status}).`,
      502,
      "MONDAY_INVALID_RESPONSE",
    );
  }

  if (!response.ok || payload?.errors?.length) {
    throw new AppError(
      mondayErrorMessage(payload, response, stage),
      502,
      "MONDAY_API_ERROR",
    );
  }

  if (!payload?.data) {
    throw new AppError(
      `Monday API — ${stage}: resposta sem dados.`,
      502,
      "MONDAY_EMPTY_RESPONSE",
    );
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
  const boardQuery = `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        id
        name
        columns { id title type }
      }
    }
  `;

  const boardData = await monday(
    boardQuery,
    { boardId: [String(boardId)] },
    "carregamento do quadro",
  );
  const board = boardData?.boards?.[0];
  if (!board) {
    throw new AppError(
      `Quadro ${boardId} não encontrado ou sem permissão para o token configurado.`,
      502,
      "BOARD_NOT_FOUND",
    );
  }

  const gestorCol = findColumn(board.columns || [], GESTOR_TITLES);
  const revisorCol = findColumn(board.columns || [], REVISOR_TITLES);
  if (!gestorCol || !revisorCol) {
    const nomes = (board.columns || []).map((c: any) => c.title).join(", ");
    throw new AppError(
      `Não localizei as duas colunas de responsáveis. Colunas disponíveis: ${nomes}`,
      422,
      "PEOPLE_COLUMNS_NOT_FOUND",
    );
  }
  if (gestorCol.type !== "people" || revisorCol.type !== "people") {
    throw new AppError(
      `As colunas precisam ser do tipo Pessoas no Monday. Gestor=${gestorCol.type}; Revisor=${revisorCol.type}.`,
      422,
      "INVALID_COLUMN_TYPE",
    );
  }

  const usersQuery = `query { users(limit: 1000, page: 1) { id name email } }`;
  const usersData = await monday(usersQuery, {}, "carregamento dos responsáveis");

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

  const first = await monday(
    firstQuery,
    { boardId: [String(boardId)] },
    "carregamento dos itens",
  );
  let page = first?.boards?.[0]?.items_page;
  const items: any[] = [...(page?.items || [])];
  let cursor = page?.cursor || null;
  let guard = 0;

  while (cursor && guard < 20) {
    const nextQuery = `query ($cursor: String!) { next_items_page(cursor: $cursor, limit: 500) { ${fragment} } }`;
    const next = await monday(nextQuery, { cursor }, "paginação dos itens");
    page = next?.next_items_page;
    items.push(...(page?.items || []));
    cursor = page?.cursor || null;
    guard++;
  }

  if (cursor) {
    throw new AppError(
      "O quadro ultrapassou o limite seguro de 10.500 itens desta versão.",
      422,
      "ITEM_PAGE_LIMIT",
    );
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
    users: (usersData?.users || []).map((u: any) => ({
      id: String(u.id),
      name: u.name,
      email: u.email || "",
    })),
    items: normalizedItems,
    diagnostics: { api_version: API_VERSION, pages_read: guard + 1 },
  };
}

async function updateResponsaveis(boardId: number, body: any) {
  const itemId = String(body?.item_id || "").trim();
  if (!/^\d+$/.test(itemId)) {
    throw new AppError("ID do item inválido.", 400, "INVALID_ITEM_ID");
  }

  const columnsQuery = `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) { columns { id title type } }
    }
  `;
  const columnsData = await monday(
    columnsQuery,
    { boardId: [String(boardId)] },
    "validação das colunas",
  );
  const columns = columnsData?.boards?.[0]?.columns || [];
  const gestorCol = findColumn(columns, GESTOR_TITLES);
  const revisorCol = findColumn(columns, REVISOR_TITLES);

  if (!gestorCol || !revisorCol || gestorCol.type !== "people" || revisorCol.type !== "people") {
    throw new AppError(
      "As colunas oficiais de Gestor e Revisor não estão disponíveis no quadro.",
      422,
      "PEOPLE_COLUMNS_NOT_FOUND",
    );
  }

  const gestorColumnId = String(gestorCol.id).replace(/[^a-zA-Z0-9_]/g, "");
  const revisorColumnId = String(revisorCol.id).replace(/[^a-zA-Z0-9_]/g, "");

  const makePeople = (id: unknown) => {
    const value = String(id ?? "").trim();
    if (value && !/^\d+$/.test(value)) {
      throw new AppError("Responsável inválido.", 400, "INVALID_PERSON_ID");
    }
    return { personsAndTeams: value ? [{ id: Number(value), kind: "person" }] : [] };
  };

  const columnValues: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body, "gestor_user_id")) {
    columnValues[gestorColumnId] = makePeople(body.gestor_user_id);
  }
  if (Object.prototype.hasOwnProperty.call(body, "revisor_user_id")) {
    columnValues[revisorColumnId] = makePeople(body.revisor_user_id);
  }
  if (!Object.keys(columnValues).length) {
    throw new AppError("Nenhuma alteração foi informada.", 400, "NO_CHANGES");
  }

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

  const data = await monday(
    mutation,
    {
      boardId: String(boardId),
      itemId,
      values: JSON.stringify(columnValues),
    },
    "atualização dos responsáveis",
  );

  return { ok: true, item: data?.change_multiple_column_values };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({ ok: false, error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" }, 405);
  }

  try {
    await validateUser(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "bootstrap");
    const boardId = Number(Deno.env.get("MONDAY_VALIDACAO_BOARD_ID") || DEFAULT_BOARD_ID);
    const requestedBoardId = Number(body?.board_id || boardId);

    if (!Number.isFinite(boardId) || !Number.isFinite(requestedBoardId)) {
      throw new AppError("Board ID inválido.", 400, "INVALID_BOARD_ID");
    }
    if (requestedBoardId !== boardId) {
      throw new AppError(
        "O quadro solicitado não está autorizado para esta aplicação.",
        403,
        "BOARD_NOT_ALLOWED",
      );
    }

    if (action === "bootstrap") return json(await bootstrap(boardId));
    if (action === "update") return json(await updateResponsaveis(boardId, body));
    return json({ ok: false, error: "Ação inválida.", code: "INVALID_ACTION" }, 400);
  } catch (e) {
    console.error(e instanceof AppError ? { code: e.code, message: e.message } : e);
    const message = e instanceof Error ? e.message : String(e);
    const status = e instanceof AppError ? e.status : 500;
    const code = e instanceof AppError ? e.code : "UNEXPECTED_ERROR";
    return json({ ok: false, error: message, code }, status);
  }
});
