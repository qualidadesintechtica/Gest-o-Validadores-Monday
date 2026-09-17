(function () {
  "use strict";

  window.GV_SCRIPT_LOADED = true;

  const ROOT_BOARD_ID = Number(window.APP_CONFIG.BOARD_ID);
  const GROUP_PAGE_SIZE = 30;
  const MAX_VISIBLE_COLUMNS = 12;
  const GROUP_COLORS = ["#579bfc", "#00c875", "#fdab3d", "#a25ddc", "#e2445c", "#0086c0", "#cab641", "#784bd1"];

  let state = {
    boards: [],
    missingTargets: [],
    users: [],
    sortedUsers: [],
    board: null,
    columns: [],
    views: [],
    activeViewId: "",
    visibleIds: [],
    items: [],
    collapsedGroups: new Set(),
    groupLimits: new Map(),
    cell: null,
    loadToken: 0
  };

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
  const norm = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const boardKey = value => norm(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

  function parseJson(value, fallback = {}) {
    if (value && typeof value === "object") return value;
    if (!value) return fallback;
    try { return JSON.parse(value); } catch (_error) { return fallback; }
  }

  function toast(message, error = false) {
    const element = $("gvToast");
    element.textContent = message;
    element.className = "gv-toast" + (error ? " error" : "");
    element.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { element.hidden = true; }, 5200);
  }

  function integrationMessage(payload, status) {
    const received = String(payload?.error || payload?.message || "").trim();
    if (received) return received;
    if (status === 401) return "Sua sessão expirou. Entre novamente.";
    if (status === 404) return "A função monday-responsaveis não foi encontrada.";
    if (status >= 500) return "A integração com o Monday falhou no servidor.";
    return `Não foi possível concluir a operação (HTTP ${status}).`;
  }

  async function call(action, extra = {}) {
    const { data, error } = await window.appSupabase.auth.getSession();
    if (error || !data?.session?.access_token) throw new Error("Sessão expirada. Entre novamente.");
    let response;
    try {
      response = await fetch(`${window.APP_CONFIG.SUPABASE_URL}/functions/v1/monday-responsaveis`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
          apikey: window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY
        },
        body: JSON.stringify({ action, ...extra })
      });
    } catch (error) {
      console.error("Falha de rede", error);
      throw new Error("Não foi possível acessar a integração.");
    }
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch (_error) {}
    if (!response.ok || payload?.ok === false) throw new Error(integrationMessage(payload, response.status));
    if (!payload || typeof payload !== "object") throw new Error("A integração respondeu em formato inválido.");
    return payload;
  }

  function groupColor(name) {
    const value = norm(name);
    if (value.startsWith("a liberar")) return "#c4c4c4";
    if (value.includes("liberado")) return "#fdab3d";
    if (value.includes("revalid")) return "#ff642e";
    if (value.includes("ajuste")) return "#579bfc";
    if (value.includes("validado")) return "#00c875";
    if (value.includes("pausado")) return "#e2445c";
    let hash = 0;
    for (const char of String(name || "")) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
  }

  function valueFor(item, columnId) {
    return (item.values || []).find(value => String(value.id) === String(columnId)) || {
      id: columnId, type: "", text: "", value: null
    };
  }

  function userLabel(user) {
    const name = String(user?.name || "").trim();
    const email = String(user?.email || "").trim();
    return email && norm(name) !== norm(email) ? `${name} · ${email}` : (name || email);
  }

  function matchesPerson(item, userId) {
    if (!userId) return true;
    const user = state.users.find(candidate => String(candidate.id) === String(userId));
    return state.visibleIds.some(columnId => {
      const column = state.columns.find(candidate => candidate.id === columnId);
      if (column?.type !== "people") return false;
      const cell = valueFor(item, columnId);
      const raw = parseJson(cell.value, {});
      const people = raw.personsAndTeams || raw.persons_and_teams || [];
      return people.some(person => String(person.id) === String(userId)) ||
        (user && norm(cell.text).includes(norm(user.name)));
    });
  }

  function filteredItems() {
    const query = norm($("gvBusca").value);
    const group = $("gvGrupo").value;
    const person = $("gvPessoa").value;
    const order = $("gvOrdenar").value;
    const rows = state.items.filter(item => {
      const text = [item.name, item.group_title, ...state.visibleIds.map(id => valueFor(item, id).text)].join(" ");
      return (!group || item.group_title === group) && matchesPerson(item, person) && (!query || norm(text).includes(query));
    });
    if (order === "name-asc") rows.sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
    if (order === "name-desc") rows.sort((a, b) => String(b.name).localeCompare(String(a.name), "pt-BR"));
    if (order === "group") rows.sort((a, b) => String(a.group_title).localeCompare(String(b.group_title), "pt-BR") || String(a.name).localeCompare(String(b.name), "pt-BR"));
    return rows;
  }

  function cellBadge(column, cell) {
    const text = cell.text || "—";
    const readOnly = column.editable === false ? " is-readonly" : "";
    const typeClass = ["status", "dropdown", "people", "date", "timeline", "checkbox"].includes(column.type)
      ? ` type-${column.type}` : "";
    return `<button type="button" class="gv-cell${readOnly}${typeClass}" data-item-id="${esc(cell.itemId)}" data-column-id="${esc(column.id)}" ${column.editable === false ? 'aria-disabled="true"' : ""} title="${column.editable === false ? "Somente leitura" : "Editar célula"}">${esc(text)}</button>`;
  }

  function render() {
    if (!state.board) return;
    const rows = filteredItems();
    $("gvExibidos").textContent = rows.length.toLocaleString("pt-BR");
    $("gvBoardCount").textContent = `${rows.length.toLocaleString("pt-BR")} ${rows.length === 1 ? "item" : "itens"}`;
    const filterCount = [$("gvGrupo").value, $("gvPessoa").value].filter(Boolean).length;
    $("gvFiltroLabel").textContent = filterCount ? `Filtro / ${filterCount}` : "Filtro";
    $("gvOrdenarLabel").textContent = $("gvOrdenar").value === "board" ? "Ordenar" : "Ordenar / 1";

    const grouping = $("gvAgrupar").value;
    const groups = new Map();
    rows.forEach(item => {
      const key = grouping === "none" ? "Todos os itens" : (item.group_title || "Sem grupo");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    const visibleColumns = state.visibleIds.map(id => state.columns.find(column => column.id === id)).filter(Boolean);
    const minWidth = 300 + visibleColumns.length * 190;
    const html = [];
    groups.forEach((items, groupName) => {
      const collapsed = state.collapsedGroups.has(groupName);
      const limit = state.groupLimits.get(groupName) || GROUP_PAGE_SIZE;
      const visibleItems = items.slice(0, limit);
      const remaining = Math.max(0, items.length - visibleItems.length);
      html.push(`<section class="gv-monday-group" style="--group-color:${groupColor(groupName)};min-width:${minWidth}px" data-group="${esc(groupName)}">
        <button class="gv-group-toggle" type="button" data-group="${esc(groupName)}" aria-expanded="${collapsed ? "false" : "true"}">
          <span class="gv-group-chevron ${collapsed ? "is-collapsed" : ""}">⌄</span>
          <span class="gv-group-title">${esc(groupName)}</span>
          <span class="gv-group-count">${items.length.toLocaleString("pt-BR")} ${items.length === 1 ? "item" : "itens"}</span>
        </button>
        <div class="gv-group-body ${collapsed ? "is-collapsed" : ""}"><div class="gv-group-table-scroll">
        <table class="gv-group-table gv-dynamic-table" style="min-width:${minWidth}px"><thead><tr>
          <th class="gv-col-item">Item</th>
          ${visibleColumns.map(column => `<th><span>${esc(column.title)}</span><small>${esc(column.type)}${column.editable === false ? " · somente leitura" : ""}</small></th>`).join("")}
        </tr></thead><tbody>`);
      visibleItems.forEach(item => {
        html.push(`<tr class="gv-data-row" data-id="${esc(item.id)}"><td class="gv-item-cell">
          <button type="button" class="gv-item-name gv-name-edit" data-item-id="${esc(item.id)}" title="Editar nome">${esc(item.name)}</button>
          <span class="gv-current">ID ${esc(item.id)}</span></td>
          ${visibleColumns.map(column => {
            const cell = valueFor(item, column.id);
            return `<td>${cellBadge(column, { ...cell, itemId: item.id })}</td>`;
          }).join("")}
        </tr>`);
      });
      html.push("</tbody></table></div>");
      if (remaining > 0) {
        const next = Math.min(items.length, limit + GROUP_PAGE_SIZE);
        html.push(`<button class="gv-show-more" type="button" data-group="${esc(groupName)}" data-next="${next}">Mostrar mais ${Math.min(GROUP_PAGE_SIZE, remaining).toLocaleString("pt-BR")}<span>${visibleItems.length.toLocaleString("pt-BR")} de ${items.length.toLocaleString("pt-BR")}</span></button>`);
      }
      html.push("</div></section>");
    });
    $("gvBoardContent").innerHTML = html.join("") || '<div class="gv-empty">Nenhum item encontrado.</div>';
  }

  function renderFilters() {
    const currentGroup = $("gvGrupo").value;
    const currentPerson = $("gvPessoa").value;
    const groups = [...new Set(state.items.map(item => item.group_title).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    $("gvGrupo").innerHTML = '<option value="">Todos os grupos</option>' + groups.map(group => `<option value="${esc(group)}">${esc(group)}</option>`).join("");
    if (groups.includes(currentGroup)) $("gvGrupo").value = currentGroup;
    $("gvPessoa").innerHTML = '<option value="">Todas</option>' + state.sortedUsers.map(user => `<option value="${esc(user.id)}">${esc(userLabel(user))}</option>`).join("");
    if (state.users.some(user => String(user.id) === String(currentPerson))) $("gvPessoa").value = currentPerson;
  }

  function renderColumnMenu() {
    $("gvColumnLabel").textContent = `Colunas / ${state.visibleIds.length}`;
    $("gvColumnList").innerHTML = state.columns.map(column => `<label title="${esc(column.type)}">
      <input type="checkbox" value="${esc(column.id)}" ${state.visibleIds.includes(column.id) ? "checked" : ""}>
      <span>${esc(column.title)}</span><small>${esc(column.type)}</small>
    </label>`).join("");
  }

  function renderViews() {
    const savedViews = state.views.filter(view => {
      const name = norm(view.name);
      return name !== "quadro principal" && name !== "main table" && name !== "tabela principal";
    });
    const buttons = [
      `<button type="button" class="gv-view-tab ${state.activeViewId ? "" : "is-active"}" data-view-id="">Quadro principal</button>`,
      ...savedViews.map(view => `<button type="button" class="gv-view-tab ${String(view.id) === String(state.activeViewId) ? "is-active" : ""}" data-view-id="${esc(view.id)}" title="${esc(view.type || "Visualização salva")}">${esc(view.name)}</button>`),
    ];
    $("gvViews").innerHTML = buttons.join("");
  }

  function savedColumns(boardId) {
    try {
      const value = JSON.parse(localStorage.getItem(`gv-columns-${boardId}`) || "[]");
      return Array.isArray(value) ? value.slice(0, MAX_VISIBLE_COLUMNS) : [];
    } catch (_error) { return []; }
  }

  async function loadBoard(boardId, columnIds = null, viewId = "") {
    const token = ++state.loadToken;
    $("gvStatus").textContent = "Carregando...";
    $("gvBoardContent").innerHTML = '<div class="gv-loading">Carregando quadro e colunas do Monday...</div>';
    document.querySelectorAll("[data-board-target]").forEach(element => element.classList.remove("is-active"));
    try {
      const payload = await call("board_data", {
        board_id: Number(boardId),
        column_ids: columnIds || savedColumns(boardId),
        view_id: viewId || null
      });
      if (token !== state.loadToken) return;
      state.board = payload.board;
      state.columns = Array.isArray(payload.columns) ? payload.columns : [];
      state.views = Array.isArray(payload.views) ? payload.views : [];
      state.activeViewId = String(payload.active_view_id || "");
      state.visibleIds = Array.isArray(payload.selected_column_ids) ? payload.selected_column_ids : [];
      state.items = Array.isArray(payload.items) ? payload.items : [];
      state.collapsedGroups = new Set();
      state.groupLimits = new Map();
      localStorage.setItem(`gv-columns-${boardId}`, JSON.stringify(state.visibleIds));
      $("gvBoardTitle").textContent = payload.board.name;
      const activeView = state.views.find(view => String(view.id) === state.activeViewId);
      $("gvBoardSubtitle").textContent = activeView ? `Filtro salvo: ${activeView.name}` : "Edição interna das colunas do quadro";
      $("gvBoard").textContent = `${payload.board.name} · ${payload.board.id}`;
      $("gvTotal").textContent = Number(payload.board.items_count || state.items.length).toLocaleString("pt-BR");
      $("gvStatus").textContent = "Conectado";
      document.querySelectorAll("[data-board-id]").forEach(element => element.classList.toggle("is-active", String(element.dataset.boardId) === String(boardId)));
      renderFilters();
      renderColumnMenu();
      renderViews();
      render();
    } catch (error) {
      console.error(error);
      $("gvStatus").textContent = "Erro";
      $("gvBoardContent").innerHTML = `<div class="gv-empty gv-empty-error">${esc(error.message)}</div>`;
      toast(error.message, true);
    }
  }

  function findBoard(target) {
    const wanted = boardKey(target);
    const mapped = state.boards.find(board => boardKey(board.menu_target) === wanted);
    if (mapped) return mapped;
    const exact = state.boards.find(board => boardKey(board.name) === wanted);
    if (exact) return exact;
    const candidates = state.boards.filter(board => boardKey(board.name).includes(wanted) || wanted.includes(boardKey(board.name)));
    return candidates.length === 1 ? candidates[0] : null;
  }

  function syncBoardMenu() {
    document.querySelectorAll("[data-board-target]").forEach(element => {
      const board = findBoard(element.dataset.boardTarget);
      element.classList.toggle("is-unavailable", !board);
      element.dataset.boardId = board?.id || "";
      element.title = board
        ? `Carregar ${board.name} dentro do sistema`
        : "Este item não apareceu como quadro na API do Monday. Pode ser painel, pasta, nome diferente ou falta de permissão.";
    });
  }

  function settingsFor(column) {
    return parseJson(column?.settings, column?.settings || {});
  }

  function labelsFor(column) {
    const settings = settingsFor(column);
    const labels = settings?.labels || settings?.labels_colors || [];
    if (Array.isArray(labels)) {
      return labels.map((entry, index) => ({ id: String(entry?.id ?? index), name: String(entry?.name ?? entry?.label ?? entry) }));
    }
    return Object.entries(labels || {}).map(([id, entry]) => ({
      id: String(id), name: String(typeof entry === "object" ? (entry?.name ?? entry?.label ?? id) : entry)
    })).filter(entry => entry.name);
  }

  function openNameEditor(item) {
    state.cell = { item, isName: true };
    $("gvCellType").textContent = "ITEM";
    $("gvCellTitle").textContent = "Nome do item";
    $("gvCellEditor").innerHTML = `<label>Nome<input id="gvEditorName" type="text" maxlength="255" required value="${esc(item.name)}"></label>`;
    $("gvCellHelp").textContent = "O nome será alterado no quadro do Monday.";
    $("gvCellClear").hidden = true;
    $("gvCellDialog").showModal();
    $("gvEditorName").focus();
  }

  function openCellEditor(item, column, cell) {
    if (column.editable === false) {
      toast(`“${column.title}” é uma coluna calculada ou controlada pelo Monday.`, true);
      return;
    }
    state.cell = { item, column, cell, isName: false };
    $("gvCellType").textContent = String(column.type || "COLUNA").toUpperCase();
    $("gvCellTitle").textContent = column.title;
    $("gvCellClear").hidden = false;
    const raw = parseJson(cell.value, {});
    const text = cell.text || "";
    let editor = "";

    if (column.type === "people") {
      const selected = new Set((raw.personsAndTeams || raw.persons_and_teams || []).map(person => String(person.id)));
      editor = `<label>Pessoas<select id="gvEditorPeople" multiple size="9">${state.sortedUsers.map(user => `<option value="${esc(user.id)}" ${selected.has(String(user.id)) ? "selected" : ""}>${esc(userLabel(user))}</option>`).join("")}</select></label><small>Use Ctrl para selecionar mais de uma pessoa.</small>`;
    } else if (column.type === "status") {
      const labels = labelsFor(column);
      const current = String(raw.index ?? "");
      editor = `<label>Status<select id="gvEditorStatus"><option value="">Sem status</option>${labels.map(label => `<option value="${esc(label.id)}" ${label.id === current || norm(label.name) === norm(text) ? "selected" : ""}>${esc(label.name)}</option>`).join("")}</select></label>`;
    } else if (column.type === "dropdown") {
      const selectedNames = new Set(text.split(",").map(value => norm(value)));
      editor = `<label>Opções<select id="gvEditorDropdown" multiple size="8">${labelsFor(column).map(label => `<option value="${esc(label.name)}" ${selectedNames.has(norm(label.name)) ? "selected" : ""}>${esc(label.name)}</option>`).join("")}</select></label><small>Use Ctrl para selecionar mais de uma opção.</small>`;
    } else if (column.type === "date") {
      editor = `<label>Data<input id="gvEditorDate" type="date" value="${esc(raw.date || text.slice(0, 10))}"></label>`;
    } else if (column.type === "timeline") {
      editor = `<div class="gv-editor-grid"><label>Início<input id="gvEditorFrom" type="date" value="${esc(raw.from || "")}"></label><label>Fim<input id="gvEditorTo" type="date" value="${esc(raw.to || "")}"></label></div>`;
    } else if (column.type === "week") {
      editor = `<div class="gv-editor-grid"><label>Início<input id="gvEditorWeekStart" type="date" value="${esc(raw.startDate || raw.start_date || "")}"></label><label>Fim<input id="gvEditorWeekEnd" type="date" value="${esc(raw.endDate || raw.end_date || "")}"></label></div>`;
    } else if (column.type === "checkbox") {
      const checked = raw.checked === true || raw.checked === "true" || norm(text) === "v";
      editor = `<label class="gv-editor-check"><input id="gvEditorCheckbox" type="checkbox" ${checked ? "checked" : ""}> Marcado</label>`;
    } else if (column.type === "board_relation" || column.type === "dependency") {
      const ids = raw.item_ids || raw.linkedPulseIds || [];
      editor = `<label>IDs dos itens relacionados<textarea id="gvEditorRelations" rows="4" placeholder="123456, 789012">${esc(ids.join(", "))}</textarea></label>`;
    } else if (column.type === "link") {
      editor = `<label>URL<input id="gvEditorUrl" type="url" value="${esc(raw.url || text)}"></label><label>Texto do link<input id="gvEditorLinkText" type="text" value="${esc(raw.text || "")}"></label>`;
    } else if (column.type === "email") {
      editor = `<label>E-mail<input id="gvEditorEmail" type="email" value="${esc(raw.email || text)}"></label><label>Nome exibido<input id="gvEditorEmailText" type="text" value="${esc(raw.text || "")}"></label>`;
    } else if (column.type === "phone") {
      editor = `<label>Telefone<input id="gvEditorPhone" type="text" value="${esc(raw.phone || text)}"></label><label>País<input id="gvEditorCountry" type="text" maxlength="2" value="${esc(raw.countryShortName || "BR")}"></label>`;
    } else if (column.type === "numbers") {
      editor = `<label>Número<input id="gvEditorNumber" type="number" step="any" value="${esc(text)}"></label>`;
    } else if (column.type === "rating") {
      editor = `<label>Avaliação<input id="gvEditorRating" type="number" min="1" max="5" step="1" value="${esc(raw.rating || text)}"></label>`;
    } else if (column.type === "hour") {
      const hour = String(raw.hour ?? "").padStart(2, "0");
      const minute = String(raw.minute ?? "").padStart(2, "0");
      editor = `<label>Horário<input id="gvEditorHour" type="time" value="${/^\d{2}:\d{2}$/.test(`${hour}:${minute}`) ? `${hour}:${minute}` : ""}"></label>`;
    } else if (column.type === "country") {
      editor = `<label>Código do país<input id="gvEditorCountryCode" type="text" maxlength="2" placeholder="BR" value="${esc(raw.countryCode || "")}"></label><label>Nome do país<input id="gvEditorCountryName" type="text" placeholder="Brasil" value="${esc(raw.countryName || text)}"></label>`;
    } else if (column.type === "location") {
      editor = `<label>Endereço<input id="gvEditorAddress" type="text" value="${esc(raw.address || text)}"></label><div class="gv-editor-grid"><label>Latitude<input id="gvEditorLat" type="number" step="any" value="${esc(raw.lat ?? "")}"></label><label>Longitude<input id="gvEditorLng" type="number" step="any" value="${esc(raw.lng ?? "")}"></label></div>`;
    } else if (column.type === "color_picker") {
      const color = /^#[0-9a-f]{6}$/i.test(raw.color || text) ? (raw.color || text) : "#579bfc";
      editor = `<label>Cor<input id="gvEditorColor" type="color" value="${esc(color)}"></label>`;
    } else if (column.type === "tags") {
      const ids = Array.isArray(raw.tag_ids) ? raw.tag_ids : [];
      editor = `<label>IDs das etiquetas<textarea id="gvEditorTags" rows="4" placeholder="123456, 789012">${esc(ids.join(", "))}</textarea></label><small>Informe os IDs de etiquetas já existentes na conta.</small>`;
    } else if (column.type === "world_clock") {
      editor = `<label>Fuso horário<input id="gvEditorTimezone" type="text" placeholder="America/Sao_Paulo" value="${esc(raw.timezone || text)}"></label>`;
    } else {
      editor = `<label>Valor<textarea id="gvEditorSimple" rows="5" maxlength="20000">${esc(text)}</textarea></label>`;
    }
    $("gvCellEditor").innerHTML = editor;
    $("gvCellHelp").textContent = "A alteração será enviada ao Monday após confirmação.";
    $("gvCellDialog").showModal();
    $("gvCellEditor").querySelector("input,select,textarea")?.focus();
  }

  function editorPayload(clear = false) {
    const context = state.cell;
    if (!context) throw new Error("Nenhuma célula selecionada.");
    if (context.isName) return { name: $("gvEditorName").value.trim() };
    const type = context.column.type;
    if (clear) return ["people", "timeline", "week", "checkbox", "board_relation", "dependency", "link", "email", "phone", "hour", "country", "location", "color_picker", "tags"].includes(type)
      ? { mode: "json", json_value: null } : { mode: "simple", simple_value: "" };
    if (type === "people") {
      const selected = [...$("gvEditorPeople").selectedOptions].map(option => ({ id: Number(option.value), kind: "person" }));
      return { mode: "json", json_value: { personsAndTeams: selected } };
    }
    if (type === "status") return { mode: "simple", simple_value: $("gvEditorStatus").value };
    if (type === "dropdown") return { mode: "simple", simple_value: [...$("gvEditorDropdown").selectedOptions].map(option => option.value).join(",") };
    if (type === "date") return { mode: "simple", simple_value: $("gvEditorDate").value };
    if (type === "timeline") return { mode: "json", json_value: { from: $("gvEditorFrom").value, to: $("gvEditorTo").value } };
    if (type === "week") return { mode: "json", json_value: { startDate: $("gvEditorWeekStart").value, endDate: $("gvEditorWeekEnd").value } };
    if (type === "checkbox") return { mode: "json", json_value: { checked: $("gvEditorCheckbox").checked ? "true" : "false" } };
    if (type === "board_relation" || type === "dependency") {
      const ids = $("gvEditorRelations").value.split(/[,;\s]+/).map(value => Number(value)).filter(Number.isFinite);
      return { mode: "json", json_value: { item_ids: ids } };
    }
    if (type === "link") return { mode: "json", json_value: { url: $("gvEditorUrl").value.trim(), text: $("gvEditorLinkText").value.trim() } };
    if (type === "email") return { mode: "json", json_value: { email: $("gvEditorEmail").value.trim(), text: $("gvEditorEmailText").value.trim() } };
    if (type === "phone") return { mode: "json", json_value: { phone: $("gvEditorPhone").value.trim(), countryShortName: $("gvEditorCountry").value.trim().toUpperCase() || "BR" } };
    if (type === "numbers") return { mode: "simple", simple_value: $("gvEditorNumber").value };
    if (type === "rating") return { mode: "simple", simple_value: $("gvEditorRating").value };
    if (type === "hour") {
      const [hour, minute] = $("gvEditorHour").value.split(":").map(Number);
      return { mode: "json", json_value: { hour, minute } };
    }
    if (type === "country") return { mode: "json", json_value: { countryCode: $("gvEditorCountryCode").value.trim().toUpperCase(), countryName: $("gvEditorCountryName").value.trim() } };
    if (type === "location") {
      const lat = Number($("gvEditorLat").value);
      const lng = Number($("gvEditorLng").value);
      return { mode: "json", json_value: { address: $("gvEditorAddress").value.trim(), lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null } };
    }
    if (type === "color_picker") return { mode: "json", json_value: { color: $("gvEditorColor").value } };
    if (type === "tags") {
      const tagIds = $("gvEditorTags").value.split(/[,;\s]+/).map(value => Number(value)).filter(Number.isFinite);
      return { mode: "json", json_value: { tag_ids: tagIds } };
    }
    if (type === "world_clock") return { mode: "simple", simple_value: $("gvEditorTimezone").value.trim() };
    return { mode: "simple", simple_value: $("gvEditorSimple").value };
  }

  async function saveCell(event, clear = false) {
    event?.preventDefault();
    const context = state.cell;
    if (!context || !state.board) return;
    const payload = editorPayload(clear);
    if (context.isName && !payload.name) return toast("O nome não pode ficar vazio.", true);
    if (!confirm("Confirmar esta alteração diretamente no Monday?")) return;
    const submit = $("gvCellSubmit");
    submit.disabled = true;
    submit.textContent = "Salvando...";
    try {
      const result = context.isName
        ? await call("update_item_name", { board_id: Number(state.board.id), item_id: context.item.id, name: payload.name })
        : await call("update_cell", { board_id: Number(state.board.id), item_id: context.item.id, column_id: context.column.id, ...payload });
      const item = state.items.find(candidate => String(candidate.id) === String(context.item.id));
      if (item && context.isName) item.name = result.item?.name || payload.name;
      if (item && !context.isName) {
        const returned = result.item?.column_values?.[0];
        const index = item.values.findIndex(value => value.id === context.column.id);
        const next = returned ? { id: String(returned.id), type: returned.type, text: returned.text || "", value: returned.value ?? null } : { ...context.cell, text: clear ? "" : context.cell.text };
        if (index >= 0) item.values[index] = next; else item.values.push(next);
      }
      $("gvCellDialog").close();
      state.cell = null;
      render();
      toast("Alteração salva no Monday com sucesso.");
    } catch (error) {
      console.error(error);
      toast(error.message, true);
    } finally {
      submit.disabled = false;
      submit.textContent = "Salvar alteração";
    }
  }

  function resetLimitsAndRender() {
    state.groupLimits = new Map();
    render();
  }

  function bindInteractions() {
    ["gvBusca", "gvGlobalBusca"].forEach(id => $(id).addEventListener("input", event => {
      const other = id === "gvBusca" ? $("gvGlobalBusca") : $("gvBusca");
      other.value = event.target.value;
      resetLimitsAndRender();
    }));
    ["gvGrupo", "gvPessoa", "gvOrdenar", "gvAgrupar"].forEach(id => $(id).addEventListener("change", resetLimitsAndRender));

    document.querySelectorAll("[data-board-target]").forEach(element => element.addEventListener("click", () => {
      const boardId = element.dataset.boardId;
      if (!boardId) return toast(`“${element.dataset.boardTarget}” não apareceu como quadro acessível na API. Verifique se é painel/pasta, o nome real ou a permissão do token.`, true);
      loadBoard(boardId, null, "");
    }));
    document.querySelectorAll("[data-section-toggle]").forEach(section => section.addEventListener("click", () => {
      const name = section.dataset.sectionToggle;
      const collapse = !section.classList.contains("is-collapsed");
      section.classList.toggle("is-collapsed", collapse);
      document.querySelectorAll(`[data-section-item="${name}"]`).forEach(item => item.classList.toggle("is-section-hidden", collapse));
    }));

    $("gvApplyColumns").addEventListener("click", () => {
      const selected = [...$("gvColumnList").querySelectorAll("input:checked")].map(input => input.value);
      if (!selected.length) return toast("Selecione pelo menos uma coluna.", true);
      if (selected.length > MAX_VISIBLE_COLUMNS) return toast(`Selecione no máximo ${MAX_VISIBLE_COLUMNS} colunas por vez.`, true);
      $("gvColumnMenu").open = false;
      loadBoard(state.board.id, selected, state.activeViewId);
    });
    $("gvAtualizar").addEventListener("click", () => state.board && loadBoard(state.board.id, state.visibleIds, state.activeViewId));
    $("gvLimpar").addEventListener("click", () => {
      $("gvBusca").value = ""; $("gvGlobalBusca").value = ""; $("gvGrupo").value = "";
      $("gvPessoa").value = ""; $("gvOrdenar").value = "board"; resetLimitsAndRender();
    });
    $("gvExpandir").addEventListener("click", () => { state.collapsedGroups.clear(); render(); });
    $("gvRecolher").addEventListener("click", () => {
      const names = $("gvAgrupar").value === "none" ? ["Todos os itens"] : [...new Set(filteredItems().map(item => item.group_title || "Sem grupo"))];
      state.collapsedGroups = new Set(names); render();
    });

    $("gvBoardContent").addEventListener("click", event => {
      const toggle = event.target.closest(".gv-group-toggle");
      if (toggle) {
        const name = toggle.dataset.group;
        if (state.collapsedGroups.has(name)) state.collapsedGroups.delete(name); else state.collapsedGroups.add(name);
        render(); return;
      }
      const more = event.target.closest(".gv-show-more");
      if (more) { state.groupLimits.set(more.dataset.group, Number(more.dataset.next) || GROUP_PAGE_SIZE); render(); return; }
      const nameButton = event.target.closest(".gv-name-edit");
      if (nameButton) {
        const item = state.items.find(candidate => candidate.id === nameButton.dataset.itemId);
        if (item) openNameEditor(item);
        return;
      }
      const cellButton = event.target.closest(".gv-cell");
      if (cellButton) {
        const item = state.items.find(candidate => candidate.id === cellButton.dataset.itemId);
        const column = state.columns.find(candidate => candidate.id === cellButton.dataset.columnId);
        if (item && column) openCellEditor(item, column, valueFor(item, column.id));
      }
    });

    $("gvViews").addEventListener("click", event => {
      const button = event.target.closest("[data-view-id]");
      if (!button || !state.board) return;
      const viewId = button.dataset.viewId || "";
      if (viewId === state.activeViewId) return;
      loadBoard(state.board.id, state.visibleIds, viewId);
    });

    $("gvCellForm").addEventListener("submit", saveCell);
    $("gvCellClear").addEventListener("click", event => saveCell(event, true));
    ["gvCellClose", "gvCellCancel"].forEach(id => $(id).addEventListener("click", () => { $("gvCellDialog").close(); state.cell = null; }));
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      document.querySelectorAll("details[open]").forEach(details => { details.open = false; });
      if ($("gvCellDialog").open) { $("gvCellDialog").close(); state.cell = null; }
    });

    document.querySelectorAll([".gv-global-actions button", ".gv-side-icon", ".gv-boardnav button", ".gv-nav-item:not([data-board-target])", ".gv-star", ".gv-board-actions > button:not(.gv-logout)"].join(","))
      .forEach(button => button.addEventListener("click", () => toast(`${button.title || button.textContent.trim() || "Opção"}: este é um produto do portal Monday, não uma função de quadro disponível pela integração.`, true)));
    window.GV_APP_READY = true;
    $("gvControlsStatus").textContent = "V2.2.1 · filtros salvos corrigidos";
  }

  async function start() {
    bindInteractions();
    let user;
    try {
      if (typeof window.protegerPagina !== "function") throw new Error("O módulo de autenticação não foi carregado.");
      user = await window.protegerPagina();
    } catch (error) {
      $("gvStatus").textContent = "Erro de inicialização";
      $("gvBoardContent").innerHTML = `<div class="gv-empty gv-empty-error">${esc(error.message)}</div>`;
      return toast(error.message, true);
    }
    if (!user) return;

    const name = document.querySelector("[data-user-name]")?.textContent || user.email || "U";
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    const initials = ((parts[0]?.[0] || "U") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
    document.querySelectorAll("[data-user-avatar]").forEach(avatar => { avatar.textContent = initials; });

    try {
      const payload = await call("workspace_bootstrap");
      state.boards = Array.isArray(payload.boards) ? payload.boards : [];
      state.missingTargets = Array.isArray(payload.missing_targets) ? payload.missing_targets : [];
      state.users = Array.isArray(payload.users) ? payload.users : [];
      state.sortedUsers = state.users.slice().sort((a, b) => userLabel(a).localeCompare(userLabel(b), "pt-BR"));
      syncBoardMenu();
      const initial = state.boards.find(board => Number(board.id) === ROOT_BOARD_ID) || state.boards.find(board => boardKey(board.name).includes("validacao de materiais")) || state.boards[0];
      if (!initial) throw new Error("Nenhum quadro do menu foi localizado para o token configurado.");
      await loadBoard(initial.id);
      if (state.missingTargets.length) {
        toast(`${state.missingTargets.length} item(ns) do menu não apareceram como quadros na API: ${state.missingTargets.join(", ")}.`, true);
      }
    } catch (error) {
      console.error(error);
      $("gvStatus").textContent = "Erro";
      $("gvBoardContent").innerHTML = `<div class="gv-empty gv-empty-error">${esc(error.message)}</div>`;
      toast(error.message, true);
    }
  }

  document.addEventListener("DOMContentLoaded", start);
})();
