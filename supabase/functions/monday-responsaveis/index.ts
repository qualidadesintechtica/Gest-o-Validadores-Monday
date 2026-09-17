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
const MAX_FILTER_COLUMNS = 12;
const MAX_LOADED_COLUMNS = MAX_VISIBLE_COLUMNS + MAX_FILTER_COLUMNS;
const NAVIGATION_TARGETS = [
  { label: "Oferta para Produção", aliases: ["oferta para producao"] },
  { label: "Contratação Conteudista", aliases: ["contratacao conteudista", "contratacao de conteudista"] },
  { label: "Esteira de Produção", aliases: ["esteira de producao"] },
  { label: "Validação de Materiais", aliases: ["validacao de materiais"] },
  { label: "Avaliação da Atuação", aliases: ["avaliacao da atuacao", "avaliacao da atuacao na validacao"] },
  { label: "Critérios de Avaliação", aliases: ["criterios de avaliacao", "criterios para avaliacao"] },
  { label: "Painéis de validação", aliases: ["paineis de validacao", "painel de validacao"] },
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
  menu_target?: string;
};

type NavigationDiscovery = {
  boards: BoardLink[];
  missingTargets: string[];
  scannedCount: number;
};

let navigationCache: ({ at: number; rootId: number } & NavigationDiscovery) | null = null;

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

function significantTokens(value: unknown) {
  const ignored = new Set(["a", "as", "de", "da", "das", "do", "dos", "e", "em", "na", "nas", "no", "nos", "para"]);
  return boardKey(value).split(" ").filter(token => token.length > 1 && !ignored.has(token));
}

function boardMatchScore(boardName: string, aliases: string[]) {
  const candidate = boardKey(boardName);
  let best = 0;
  for (const aliasValue of aliases) {
    const alias = boardKey(aliasValue);
    if (candidate === alias) best = Math.max(best, 100);
    else if (candidate.includes(alias) || alias.includes(candidate)) best = Math.max(best, 85);
    const wanted = significantTokens(alias);
    const available = new Set(significantTokens(candidate));
    if (wanted.length && wanted.every(token => available.has(token))) {
      best = Math.max(best, 70 + Math.min(10, wanted.length));
    }
  }
  return best;
}

function configuredBoardIds() {
  const raw = Deno.env.get("MONDAY_MENU_BOARD_IDS") || "";
  if (!raw) return new Map<string, string>();
  try {
    const parsed = JSON.parse(raw);
    const entries = parsed && typeof parsed === "object" ? Object.entries(parsed) : [];
    return new Map(entries
      .map(([label, id]) => [boardKey(label), String(id ?? "").trim()] as const)
      .filter(([, id]) => /^\d+$/.test(id)));
  } catch (_error) {
    throw new AppError("Secret MONDAY_MENU_BOARD_IDS contém JSON inválido.", 500, "INVALID_BOARD_MAP");
  }
}

function safeColumnId(value: unknown) {
  const id = String(value ?? "").trim();
  return /^[a-zA-Z0-9_]{1,128}$/.test(id) ? id : "";
}

function safeGroupId(value: unknown) {
  const id = String(value ?? "").trim();
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? id : "";
}

function jsonObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch (_error) {
    return null;
  }
}

function jsonArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

const ITEMS_QUERY_RULE_OPERATORS = new Set([
  "any_of", "not_any_of", "is_empty", "is_not_empty", "greater_than",
  "greater_than_or_equals", "lower_than", "lower_than_or_equal", "between",
  "not_contains_text", "contains_text", "contains_terms", "starts_with",
  "ends_with", "within_the_next", "within_the_last",
]);

function normalizeQueryOperator(value: unknown, context: string) {
  const operator = String(value ?? "and").trim().toLowerCase();
  if (operator === "and" || operator === "or") return operator;
  throw new AppError(`A visualização usa o operador de grupo “${operator}”, incompatível com ${context}.`, 422, "UNSUPPORTED_VIEW_FILTER");
}

function normalizeRuleOperator(value: unknown) {
  let operator = String(value ?? "").trim().toLowerCase();
  if (!operator) return "";
  if (operator === "greater_than_or_equal") operator = "greater_than_or_equals";
  if (operator === "lower_than_or_equals") operator = "lower_than_or_equal";
  if (!ITEMS_QUERY_RULE_OPERATORS.has(operator)) {
    throw new AppError(`A visualização usa o operador de filtro “${operator}”, ainda não aceito pelo Monday em items_page.`, 422, "UNSUPPORTED_VIEW_FILTER");
  }
  return operator;
}

function normalizeViewRule(value: unknown) {
  const rule = jsonObject(value);
  if (!rule) return null;
  const columnId = safeColumnId(rule.column_id);
  if (!columnId || !("compare_value" in rule)) return null;
  const normalized: Record<string, unknown> = {
    column_id: columnId,
    compare_value: rule.compare_value,
  };
  const compareAttribute = String(rule.compare_attribute ?? "").trim();
  if (compareAttribute) normalized.compare_attribute = compareAttribute;
  const operator = normalizeRuleOperator(rule.operator);
  if (operator) normalized.operator = operator;
  return normalized;
}

function normalizeViewFilter(value: unknown, context = "o filtro salvo"): Record<string, unknown> | null {
  const group = jsonObject(value);
  if (!group) return null;
  const rules = Array.isArray(group.rules) ? group.rules.map(normalizeViewRule).filter(Boolean) : [];
  const groups = Array.isArray(group.groups)
    ? group.groups.map(entry => normalizeViewFilter(entry, context)).filter(Boolean)
    : [];
  if (!rules.length && !groups.length) return null;
  const normalized: Record<string, unknown> = { operator: normalizeQueryOperator(group.operator, context) };
  if (rules.length) normalized.rules = rules;
  if (groups.length) normalized.groups = groups;
  return normalized;
}

function normalizeViewSort(value: unknown) {
  return jsonArray(value).map(entry => {
    const order = jsonObject(entry);
    if (!order) return null;
    const columnId = String(order.column_id ?? "").trim();
    if (!columnId) return null;
    const direction = String(order.direction ?? "asc").trim().toLowerCase();
    if (direction !== "asc" && direction !== "desc") {
      throw new AppError(`A visualização usa a ordenação “${direction}”, incompatível com items_page.`, 422, "UNSUPPORTED_VIEW_SORT");
    }
    return { column_id: columnId, direction };
  }).filter(Boolean);
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

async function loadAllowedBoards(rootBoardId: number, force = false): Promise<NavigationDiscovery> {
  if (!force && navigationCache && navigationCache.rootId === rootBoardId && Date.now() - navigationCache.at < 300000) {
    return navigationCache;
  }
  const rootData = await monday(
    `query ($ids: [ID!]) { boards(ids: $ids) { id name url workspace_id } }`,
    { ids: [String(rootBoardId)] },
    "identificação do workspace",
  );
  const root = rootData?.boards?.[0];
  if (!root) throw new AppError(`Quadro principal ${rootBoardId} não encontrado.`, 502, "ROOT_BOARD_NOT_FOUND");

  const candidates: BoardLink[] = [];
  for (let page = 1; page <= 10; page++) {
    const data = await monday(
      `query ($page: Int!) {
        boards(limit: ${BOARD_PAGE_SIZE}, page: $page, state: active) {
          id name url workspace_id items_count
        }
      }`,
      { page },
      "descoberta dos quadros acessíveis da conta",
    );
    const pageBoards = Array.isArray(data?.boards) ? data.boards : [];
    candidates.push(...pageBoards.map((board: any) => ({
      id: String(board.id), name: board.name, url: board.url,
      workspace_id: board.workspace_id ? String(board.workspace_id) : null,
      items_count: Number(board.items_count || 0),
    })));
    if (pageBoards.length < BOARD_PAGE_SIZE) break;
  }

  const configured = configuredBoardIds();
  const configuredIds = [...new Set(configured.values())];
  if (configuredIds.length) {
    const explicitData = await monday(
      `query ($ids: [ID!]) { boards(ids: $ids) { id name url workspace_id items_count } }`,
      { ids: configuredIds },
      "carregamento dos quadros configurados",
    );
    const known = new Set(candidates.map(candidate => candidate.id));
    for (const board of explicitData?.boards || []) {
      if (known.has(String(board.id))) continue;
      candidates.push({
        id: String(board.id), name: board.name, url: board.url,
        workspace_id: board.workspace_id ? String(board.workspace_id) : null,
        items_count: Number(board.items_count || 0),
      });
    }
  }

  const ordered: BoardLink[] = [];
  const used = new Set<string>();
  const missingTargets: string[] = [];
  NAVIGATION_TARGETS.forEach(target => {
    const configuredId = configured.get(boardKey(target.label));
    const ranked = candidates
      .filter(candidate => !used.has(candidate.id))
      .map(candidate => ({
        candidate,
        score: configuredId === candidate.id
          ? 1000
          : boardMatchScore(candidate.name, target.aliases) + (candidate.workspace_id === String(root.workspace_id || "") ? 3 : 0),
      }))
      .filter(entry => entry.score >= 70)
      .sort((a, b) => b.score - a.score || Number(b.candidate.items_count || 0) - Number(a.candidate.items_count || 0));
    const chosen = ranked[0]?.candidate;
    if (!chosen) {
      missingTargets.push(target.label);
      return;
    }
    used.add(chosen.id);
    ordered.push({ ...chosen, menu_target: target.label });
  });
  if (!used.has(String(root.id))) {
    ordered.push({
      id: String(root.id), name: root.name, url: root.url,
      workspace_id: root.workspace_id ? String(root.workspace_id) : null,
      menu_target: "Validação de Materiais",
    });
  }
  navigationCache = {
    at: Date.now(), rootId: rootBoardId, boards: ordered,
    missingTargets, scannedCount: candidates.length,
  };
  return navigationCache;
}

async function allowedBoard(rootBoardId: number, requestedBoardId: number) {
  const { boards } = await loadAllowedBoards(rootBoardId);
  const board = boards.find(candidate => Number(candidate.id) === requestedBoardId);
  if (!board) throw new AppError("Este quadro não pertence ao menu autorizado.", 403, "BOARD_NOT_ALLOWED");
  return board;
}

async function workspaceBootstrap(rootBoardId: number) {
  const [discovery, usersData] = await Promise.all([
    loadAllowedBoards(rootBoardId),
    monday(`query { users(limit: 1000, page: 1) { id name email } }`, {}, "carregamento dos responsáveis"),
  ]);
  return {
    ok: true,
    boards: discovery.boards,
    missing_targets: discovery.missingTargets,
    users: (usersData?.users || []).map((user: any) => ({ id: String(user.id), name: user.name, email: user.email || "" })),
    diagnostics: { api_version: API_VERSION, boards_scanned: discovery.scannedCount },
  };
}

function contextColumnIds(columns: any[]) {
  const scored = columns.map((column: any, index: number) => {
    const key = norm(column.title).replace(/[^a-z0-9]+/g, " ").trim();
    const tokens = key.split(" ").filter(Boolean);
    let kind = "";
    let score = 99;
    if (key.includes("nome da uc")) { kind = "uc"; score = 0; }
    else if (key.includes("unidade curricular")) { kind = "uc"; score = 1; }
    else if (tokens.includes("uc")) { kind = "uc"; score = 2; }
    else if (key.includes("nome da ua")) { kind = "ua"; score = 10; }
    else if (key.includes("unidade de aprendizagem")) { kind = "ua"; score = 11; }
    else if (tokens.includes("ua")) { kind = "ua"; score = 12; }
    else if (tokens.includes("lote") || key.startsWith("lote ")) { kind = "lote"; score = 20; }
    return { id: String(column.id), kind, score, index };
  }).filter(entry => entry.kind);
  const chosen = new Map<string, string>();
  for (const entry of scored.sort((a, b) => a.score - b.score || a.index - b.index)) {
    if (!chosen.has(entry.kind)) chosen.set(entry.kind, entry.id);
  }
  return ["uc", "ua", "lote"].map(kind => chosen.get(kind)).filter(Boolean) as string[];
}

function defaultColumns(columns: any[]) {
  const rank = (column: any) => {
    if (column.type === "people") return 0;
    if (column.type === "status") return 1;
    if (["date", "timeline", "dropdown"].includes(column.type)) return 2;
    return 3;
  };
  const contextIds = contextColumnIds(columns);
  const otherIds = columns.slice().sort((a, b) => rank(a) - rank(b)).map(column => column.id).filter(id => !contextIds.includes(id));
  return [...contextIds, ...otherIds].slice(0, 8);
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
        views { id name type filter sort }
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
  const contextIds = contextColumnIds(columns);
  const validRequestedIds = requestedColumns.filter((id: string) => allowedIds.has(id));
  let selectedIds = validRequestedIds.length
    ? [...new Set([...contextIds, ...validRequestedIds])].slice(0, MAX_VISIBLE_COLUMNS)
    : [];
  if (!selectedIds.length) selectedIds = defaultColumns(columns);
  if (!selectedIds.length) throw new AppError("O quadro não possui colunas disponíveis.", 422, "NO_COLUMNS");
  const requestedFilterColumns = Array.isArray(body?.filter_column_ids) ? body.filter_column_ids.map(safeColumnId).filter(Boolean) : [];
  const filterIds = [...new Set(requestedFilterColumns.filter((id: string) => allowedIds.has(id) && !selectedIds.includes(id)))].slice(0, MAX_FILTER_COLUMNS);
  const loadedIds = [...selectedIds, ...filterIds].slice(0, MAX_LOADED_COLUMNS);

  const views = (board.views || []).map((view: any) => ({
    id: String(view.id), name: view.name, type: view.type,
    filter: jsonObject(view.filter), sort: jsonArray(view.sort),
  }));
  const requestedViewId = String(body?.view_id || "").trim();
  const activeView = requestedViewId ? views.find((view: any) => view.id === requestedViewId) : null;
  if (requestedViewId && !activeView) {
    throw new AppError("A visualização selecionada não existe neste quadro.", 404, "VIEW_NOT_FOUND");
  }
  let queryParams: Record<string, unknown> | null = null;
  if (activeView?.filter) queryParams = normalizeViewFilter(activeView.filter, `a visualização “${activeView.name}”`);
  const normalizedSort = activeView?.sort?.length ? normalizeViewSort(activeView.sort) : [];
  if (normalizedSort.length) queryParams = { ...(queryParams || {}), order_by: normalizedSort };

  const quotedIds = loadedIds.map(id => `"${id}"`).join(",");
  const fragment = `
    cursor
    items {
      id name
      group { id title }
      column_values(ids: [${quotedIds}]) { id text value type }
    }
  `;
  const first = await monday(
    `query ($ids: [ID!], $queryParams: ItemsQuery) {
      boards(ids: $ids) { items_page(limit: ${ITEM_PAGE_SIZE}, query_params: $queryParams) { ${fragment} } }
    }`,
    { ids: [String(requestedBoardId)], queryParams },
    activeView ? `carregamento da visualização ${activeView.name}` : "carregamento dos itens",
  );
  const page = first?.boards?.[0]?.items_page;
  const items: any[] = [...(page?.items || [])];
  const cursor = page?.cursor || null;

  return {
    ok: true,
    board: {
      id: String(board.id), name: board.name, url: board.url,
      workspace_id: board.workspace_id ? String(board.workspace_id) : null,
      items_count: Number(board.items_count || items.length),
      groups: (board.groups || []).map((group: any) => ({ id: String(group.id), title: group.title })),
    },
    columns,
    views,
    active_view_id: activeView?.id || null,
    selected_column_ids: selectedIds,
    context_column_ids: contextIds,
    loaded_filter_column_ids: filterIds,
    next_cursor: cursor,
    items: items.map(item => ({
      id: String(item.id), name: item.name,
      group_id: item.group?.id ? String(item.group.id) : null,
      group_title: item.group?.title || "Sem grupo",
      values: (item.column_values || []).map((value: any) => ({
        id: String(value.id), type: value.type, text: value.text || "", value: value.value ?? null,
      })),
    })),
    diagnostics: { api_version: API_VERSION, pages_read: 1, progressive: Boolean(cursor) },
  };
}

async function boardPage(rootBoardId: number, body: any) {
  const boardId = Number(body?.board_id);
  const cursor = String(body?.cursor || "").trim();
  if (!Number.isFinite(boardId) || !cursor || cursor.length > 10000) {
    throw new AppError("Paginação do quadro inválida.", 400, "INVALID_BOARD_PAGE");
  }
  await allowedBoard(rootBoardId, boardId);
  const visibleIds = Array.isArray(body?.column_ids) ? body.column_ids.map(safeColumnId).filter(Boolean).slice(0, MAX_VISIBLE_COLUMNS) : [];
  const filterIds = Array.isArray(body?.filter_column_ids) ? body.filter_column_ids.map(safeColumnId).filter(Boolean).slice(0, MAX_FILTER_COLUMNS) : [];
  const loadedIds = [...new Set([...visibleIds, ...filterIds])].slice(0, MAX_LOADED_COLUMNS);
  if (!loadedIds.length) throw new AppError("Nenhuma coluna foi informada para a paginação.", 400, "NO_PAGE_COLUMNS");
  const quotedIds = loadedIds.map(id => `"${id}"`).join(",");
  const data = await monday(
    `query ($cursor: String!) {
      next_items_page(cursor: $cursor, limit: ${ITEM_PAGE_SIZE}) {
        cursor
        items {
          id name
          group { id title }
          column_values(ids: [${quotedIds}]) { id text value type }
        }
      }
    }`,
    { cursor },
    "carregamento progressivo dos itens",
  );
  const page = data?.next_items_page;
  return {
    ok: true,
    next_cursor: page?.cursor || null,
    items: (page?.items || []).map((item: any) => ({
      id: String(item.id), name: item.name,
      group_id: item.group?.id ? String(item.group.id) : null,
      group_title: item.group?.title || "Sem grupo",
      values: (item.column_values || []).map((value: any) => ({
        id: String(value.id), type: value.type, text: value.text || "", value: value.value ?? null,
      })),
    })),
  };
}

async function createItem(rootBoardId: number, body: any) {
  const boardId = Number(body?.board_id);
  const groupId = safeGroupId(body?.group_id);
  const itemName = String(body?.item_name || "").replace(/\s+/g, " ").trim();
  if (!Number.isFinite(boardId) || !groupId || !itemName || itemName.length > 255) {
    throw new AppError("Informe um nome e um grupo válidos para o novo título.", 400, "INVALID_NEW_ITEM");
  }
  await allowedBoard(rootBoardId, boardId);
  const schema = await monday(
    `query ($ids: [ID!]) { boards(ids: $ids) { groups { id title } } }`,
    { ids: [String(boardId)] },
    "validação do grupo do novo título",
  );
  const group = (schema?.boards?.[0]?.groups || []).find((entry: any) => String(entry.id) === groupId);
  if (!group) throw new AppError("O grupo selecionado não existe mais neste quadro.", 404, "GROUP_NOT_FOUND");

  const data = await monday(
    `mutation ($boardId: ID!, $groupId: String!, $itemName: String!) {
      create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName) {
        id name group { id title }
      }
    }`,
    { boardId: String(boardId), groupId, itemName },
    `criação do título em ${group.title}`,
  );
  return { ok: true, item: data?.create_item };
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
    if (action === "board_page") return json(await boardPage(rootBoardId, body));
    if (action === "create_item") return json(await createItem(rootBoardId, body));
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
