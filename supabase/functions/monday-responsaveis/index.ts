const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MONDAY_URL = "https://api.monday.com/v2";
const API_VERSION = Deno.env.get("MONDAY_API_VERSION") || "2026-07";
const DEFAULT_BOARD_ID = 9433297929;
const ALLOWED_DOMAINS = ["animaeducacao.com.br"];
const BOARD_PAGE_SIZE = 100;
const ITEM_PAGE_SIZE = 500;
const MAX_VISIBLE_COLUMNS = 12;
const NAVIGATION_TITLES = [
  "oferta para producao",
  "contratacao conteudista",
  "esteira de producao",
  "validacao de materiais",
  "avaliacao da atuacao",
  "criterios de avaliacao",
  "paineis de validacao",
];
const READ_ONLY_TYPES = new Set([
  "auto_number", "creation_log", "formula", "integration", "item_id",
  "last_updated", "mirror", "progress", "subtasks", "time_tracking", "vote",
  "button", "doc", "file", "files",
]);

type BoardLink = {
  id: string;
  name: string;
  url: string;
  workspace_id: string | null;
  items_count?: number;
};

let navigationCache: { at: number; rootId: number; boards: BoardLink[] } | null = null;

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
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function norm(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function boardKey(value: unknown) {
  return norm(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function safeColumnId(value: unknown) {
  const id = String(value ?? "").trim();
  return /^[a-zA-Z0-9_]{1,128}$/.test(id) ? id : "";
}

async function validateUser(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new AppError("Sessão não informada.", 401, "AUTH_MISSING");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !anonKey) {
    throw new AppError("Configuração de autenticação indisponível.", 500, "SUPABASE_CONFIG_MISSING");
  }

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { Authorization: auth, apikey: anonKey } });
  } catch (error) {
    console.error("Falha ao validar sessão", error);
    throw new AppError("Não foi possível validar sua sessão.", 502, "SUPABASE_AUTH_UNAVAILABLE");
  }
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.email) throw new AppError("Sessão inválida ou expirada.", 401, "AUTH_INVALID");
  const domain = String(user.email).toLowerCase().split("@").pop();
  if (!ALLOWED_DOMAINS.includes(domain)) throw new AppError("Usuário não autorizado.", 403, "DOMAIN_NOT_ALLOWED");
  return user;
}

function mondayErrorMessage(payload: any, response: Response, stage: string) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const details = errors.map((entry: any) => {
    const message = String(entry?.message || "").trim();
    const code = String(entry?.extensions?.code || entry?.extensions?.error_code || "").trim();
    return [code, message].filter(Boolean).join(": ");
  }).filter(Boolean);
  const requestId = response.headers.get("x-request-id") || response.headers.get("x-amzn-trace-id") || "";
  return `Monday API — ${stage}: ${details.join(" | ") || `HTTP ${response.status}`}${requestId ? ` · requisição ${requestId}` : ""}`;
}

async function monday(query: string, variables: Record<string, unknown> = {}, stage = "consulta") {
  const token = Deno.env.get("MONDAY_API_TOKEN");
  if (!token) throw new AppError("Secret MONDAY_API_TOKEN não configurado.", 500, "MONDAY_TOKEN_MISSING");
  let response: Response;
  try {
    response = await fetch(MONDAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": token, "API-Version": API_VERSION },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    console.error(`Falha de rede no Monday durante ${stage}`, error);
    throw new AppError(`Não foi possível acessar o Monday durante ${stage}.`, 502, "MONDAY_UNAVAILABLE");
  }
  const raw = await response.text();
  let payload: any = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error("Resposta não JSON do Monday", { stage, status: response.status, error });
    throw new AppError(`Monday API — ${stage}: resposta inválida.`, 502, "MONDAY_INVALID_RESPONSE");
  }
  if (!response.ok || payload?.errors?.length) {
    throw new AppError(mondayErrorMessage(payload, response, stage), 502, "MONDAY_API_ERROR");
  }
  if (!payload?.data) throw new AppError(`Monday API — ${stage}: resposta sem dados.`, 502, "MONDAY_EMPTY_RESPONSE");
  return payload.data;
}

async function loadAllowedBoards(rootBoardId: number, force = false): Promise<BoardLink[]> {
  if (!force && navigationCache && navigationCache.rootId === rootBoardId && Date.now() - navigationCache.at < 300000) {
    return navigationCache.boards;
  }
  const rootData = await monday(
    `query ($ids: [ID!]) { boards(ids: $ids) { id name url workspace_id } }`,
    { ids: [String(rootBoardId)] },
    "identificação do workspace",
  );
  const root = rootData?.boards?.[0];
  if (!root) throw new AppError(`Quadro principal ${rootBoardId} não encontrado.`, 502, "ROOT_BOARD_NOT_FOUND");

  const workspaceId = root.workspace_id ? String(root.workspace_id) : null;
  const candidates: BoardLink[] = [];
  for (let page = 1; page <= 10; page++) {
    const data = await monday(
      `query ($page: Int!, $workspaceIds: [ID]) {
        boards(limit: ${BOARD_PAGE_SIZE}, page: $page, state: active, workspace_ids: $workspaceIds) {
          id name url workspace_id items_count
        }
      }`,
      { page, workspaceIds: workspaceId ? [workspaceId] : null },
      "carregamento dos quadros do menu",
    );
    const pageBoards = Array.isArray(data?.boards) ? data.boards : [];
    candidates.push(...pageBoards.map((board: any) => ({
      id: String(board.id), name: board.name, url: board.url,
      workspace_id: board.workspace_id ? String(board.workspace_id) : null,
      items_count: Number(board.items_count || 0),
    })));
    if (pageBoards.length < BOARD_PAGE_SIZE) break;
  }

  const ordered: BoardLink[] = [];
  const used = new Set<string>();
  NAVIGATION_TITLES.forEach(title => {
    candidates.forEach(candidate => {
      const key = boardKey(candidate.name);
      if (!used.has(candidate.id) && (key === title || key.includes(title))) {
        used.add(candidate.id);
        ordered.push(candidate);
      }
    });
  });
  if (!used.has(String(root.id))) {
    ordered.push({ id: String(root.id), name: root.name, url: root.url, workspace_id: root.workspace_id ? String(root.workspace_id) : null });
  }
  navigationCache = { at: Date.now(), rootId: rootBoardId, boards: ordered };
  return ordered;
}

async function allowedBoard(rootBoardId: number, requestedBoardId: number) {
  const boards = await loadAllowedBoards(rootBoardId);
  const board = boards.find(candidate => Number(candidate.id) === requestedBoardId);
  if (!board) throw new AppError("Este quadro não pertence ao menu autorizado.", 403, "BOARD_NOT_ALLOWED");
  return board;
}

async function workspaceBootstrap(rootBoardId: number) {
  const [boards, usersData] = await Promise.all([
    loadAllowedBoards(rootBoardId, true),
    monday(`query { users(limit: 1000, page: 1) { id name email } }`, {}, "carregamento dos responsáveis"),
  ]);
  return {
    ok: true,
    boards,
    users: (usersData?.users || []).map((user: any) => ({ id: String(user.id), name: user.name, email: user.email || "" })),
    diagnostics: { api_version: API_VERSION },
  };
}

function defaultColumns(columns: any[]) {
  const rank = (column: any) => {
    if (column.type === "people") return 0;
    if (column.type === "status") return 1;
    if (["date", "timeline", "dropdown"].includes(column.type)) return 2;
    return 3;
  };
  return columns.slice().sort((a, b) => rank(a) - rank(b)).slice(0, 8).map(column => column.id);
}

async function boardData(rootBoardId: number, body: any) {
  const requestedBoardId = Number(body?.board_id || rootBoardId);
  if (!Number.isFinite(requestedBoardId)) throw new AppError("Board ID inválido.", 400, "INVALID_BOARD_ID");
  await allowedBoard(rootBoardId, requestedBoardId);

  const schemaData = await monday(
    `query ($ids: [ID!]) {
      boards(ids: $ids) {
        id name url workspace_id items_count
        groups { id title }
        columns { id title type settings }
      }
    }`,
    { ids: [String(requestedBoardId)] },
    "carregamento da estrutura do quadro",
  );
  const board = schemaData?.boards?.[0];
  if (!board) throw new AppError("Quadro não encontrado.", 404, "BOARD_NOT_FOUND");

  const columns = (board.columns || []).map((column: any) => ({
    id: String(column.id), title: column.title, type: column.type,
    settings: column.settings || {}, editable: !READ_ONLY_TYPES.has(String(column.type)),
  }));
  const requestedColumns = Array.isArray(body?.column_ids) ? body.column_ids.map(safeColumnId).filter(Boolean) : [];
  const allowedIds = new Set(columns.map((column: any) => column.id));
  let selectedIds = [...new Set(requestedColumns.filter((id: string) => allowedIds.has(id)))].slice(0, MAX_VISIBLE_COLUMNS);
  if (!selectedIds.length) selectedIds = defaultColumns(columns);
  if (!selectedIds.length) throw new AppError("O quadro não possui colunas disponíveis.", 422, "NO_COLUMNS");

  const quotedIds = selectedIds.map(id => `"${id}"`).join(",");
  const fragment = `
    cursor
    items {
      id name
      group { id title }
      column_values(ids: [${quotedIds}]) { id text value type }
    }
  `;
  const first = await monday(
    `query ($ids: [ID!]) { boards(ids: $ids) { items_page(limit: ${ITEM_PAGE_SIZE}) { ${fragment} } } }`,
    { ids: [String(requestedBoardId)] },
    "carregamento dos itens",
  );
  let page = first?.boards?.[0]?.items_page;
  const items: any[] = [...(page?.items || [])];
  let cursor = page?.cursor || null;
  let pagesRead = 1;
  while (cursor && pagesRead < 21) {
    const next = await monday(
      `query ($cursor: String!) { next_items_page(cursor: $cursor, limit: ${ITEM_PAGE_SIZE}) { ${fragment} } }`,
      { cursor },
      "paginação dos itens",
    );
    page = next?.next_items_page;
    items.push(...(page?.items || []));
    cursor = page?.cursor || null;
    pagesRead++;
  }
  if (cursor) throw new AppError("O quadro excedeu o limite seguro de itens.", 422, "ITEM_PAGE_LIMIT");

  return {
    ok: true,
    board: {
      id: String(board.id), name: board.name, url: board.url,
      workspace_id: board.workspace_id ? String(board.workspace_id) : null,
      items_count: Number(board.items_count || items.length),
      groups: (board.groups || []).map((group: any) => ({ id: String(group.id), title: group.title })),
    },
    columns,
    selected_column_ids: selectedIds,
    items: items.map(item => ({
      id: String(item.id), name: item.name,
      group_id: item.group?.id ? String(item.group.id) : null,
      group_title: item.group?.title || "Sem grupo",
      values: (item.column_values || []).map((value: any) => ({
        id: String(value.id), type: value.type, text: value.text || "", value: value.value ?? null,
      })),
    })),
    diagnostics: { api_version: API_VERSION, pages_read: pagesRead },
  };
}

async function updateCell(rootBoardId: number, body: any) {
  const boardId = Number(body?.board_id);
  const itemId = String(body?.item_id || "").trim();
  const columnId = safeColumnId(body?.column_id);
  if (!Number.isFinite(boardId) || !/^\d+$/.test(itemId) || !columnId) {
    throw new AppError("Identificação da célula inválida.", 400, "INVALID_CELL");
  }
  await allowedBoard(rootBoardId, boardId);
  const schema = await monday(
    `query ($ids: [ID!]) { boards(ids: $ids) { columns { id title type } } }`,
    { ids: [String(boardId)] },
    "validação da coluna",
  );
  const column = (schema?.boards?.[0]?.columns || []).find((entry: any) => String(entry.id) === columnId);
  if (!column) throw new AppError("Coluna não encontrada.", 404, "COLUMN_NOT_FOUND");
  if (READ_ONLY_TYPES.has(String(column.type))) {
    throw new AppError(`A coluna “${column.title}” é somente leitura no Monday.`, 422, "READ_ONLY_COLUMN");
  }

  if (body?.mode === "json") {
    const values = JSON.stringify({ [columnId]: body?.json_value ?? null });
    const data = await monday(
      `mutation ($boardId: ID!, $itemId: ID!, $values: JSON!) {
        change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $values) {
          id name column_values(ids: ["${columnId}"]) { id text value type }
        }
      }`,
      { boardId: String(boardId), itemId, values },
      `atualização de ${column.title}`,
    );
    return { ok: true, item: data?.change_multiple_column_values };
  }

  const simpleValue = String(body?.simple_value ?? "");
  if (simpleValue.length > 20000) throw new AppError("O valor ultrapassa o limite de segurança.", 400, "VALUE_TOO_LONG");
  const data = await monday(
    `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
      change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) {
        id name column_values(ids: [$columnId]) { id text value type }
      }
    }`,
    { boardId: String(boardId), itemId, columnId, value: simpleValue },
    `atualização de ${column.title}`,
  );
  return { ok: true, item: data?.change_simple_column_value };
}

async function updateItemName(rootBoardId: number, body: any) {
  const boardId = Number(body?.board_id);
  const itemId = String(body?.item_id || "").trim();
  const name = String(body?.name || "").replace(/\s+/g, " ").trim();
  if (!Number.isFinite(boardId) || !/^\d+$/.test(itemId) || !name || name.length > 255) {
    throw new AppError("Nome ou item inválido.", 400, "INVALID_ITEM_NAME");
  }
  await allowedBoard(rootBoardId, boardId);
  const data = await monday(
    `mutation ($boardId: ID!, $itemId: ID!, $value: String!) {
      change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: "name", value: $value) { id name }
    }`,
    { boardId: String(boardId), itemId, value: name },
    "alteração do nome do item",
  );
  return { ok: true, item: data?.change_simple_column_value };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    await validateUser(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "workspace_bootstrap");
    const rootBoardId = Number(Deno.env.get("MONDAY_VALIDACAO_BOARD_ID") || DEFAULT_BOARD_ID);
    if (!Number.isFinite(rootBoardId)) throw new AppError("Board ID principal inválido.", 500, "INVALID_ROOT_BOARD");

    if (action === "workspace_bootstrap") return json(await workspaceBootstrap(rootBoardId));
    if (action === "board_data") return json(await boardData(rootBoardId, body));
    if (action === "update_cell") return json(await updateCell(rootBoardId, body));
    if (action === "update_item_name") return json(await updateItemName(rootBoardId, body));
    return json({ ok: false, error: "Ação inválida.", code: "INVALID_ACTION" }, 400);
  } catch (error) {
    console.error(error instanceof AppError ? { code: error.code, message: error.message } : error);
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof AppError ? error.status : 500;
    const code = error instanceof AppError ? error.code : "UNEXPECTED_ERROR";
    return json({ ok: false, error: message, code }, status);
  }
});
