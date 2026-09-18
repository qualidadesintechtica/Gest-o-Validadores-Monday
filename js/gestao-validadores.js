(function () {
  "use strict";

  window.GV_SCRIPT_LOADED = true;

  const ROOT_BOARD_ID = Number(window.APP_CONFIG.BOARD_ID);
  const GROUP_PAGE_SIZE = 30;
  const MAX_VISIBLE_COLUMNS = 12;
  const MAX_ADVANCED_FILTERS = 12;
  const BOOTSTRAP_CACHE_KEY = "gv-workspace-bootstrap-v2";
  const BOOTSTRAP_CACHE_MS = 30 * 60 * 1000;
  const GROUP_COLORS = ["#579bfc", "#00c875", "#fdab3d", "#a25ddc", "#e2445c", "#0086c0", "#cab641", "#784bd1"];
  const FILTER_OPERATORS = [
    { id: "contains", label: "contém" },
    { id: "not_contains", label: "não contém" },
    { id: "equals", label: "é" },
    { id: "not_equals", label: "não é" },
    { id: "is_empty", label: "está vazio", noValue: true },
    { id: "is_not_empty", label: "não está vazio", noValue: true },
    { id: "greater", label: "é maior que" },
    { id: "greater_equal", label: "é maior ou igual a" },
    { id: "less", label: "é menor que" },
    { id: "less_equal", label: "é menor ou igual a" },
    { id: "before", label: "é anterior a" },
    { id: "after", label: "é posterior a" }
  ];

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
    advancedFilterGroups: [],
    filterGroupJoin: "and",
    filterSequence: 0,
    loadedFilterIds: [],
    audit: { activeTab: "accesses", accesses: [], changes: [], loaded: false, truncated: false },
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

  function nextFilterId(prefix) {
    state.filterSequence += 1;
    return `${prefix}-${state.filterSequence}`;
  }

  function newFilterRule() {
    return { id: nextFilterId("rule"), columnId: "__name__", operator: "contains", value: "" };
  }

  function newFilterGroup() {
    return { id: nextFilterId("group"), operator: "and", rules: [newFilterRule()] };
  }

  function resetAdvancedFilters() {
    state.advancedFilterGroups = [newFilterGroup()];
    state.filterGroupJoin = "and";
    state.loadedFilterIds = [];
  }

  function allFilterRules() {
    return state.advancedFilterGroups.flatMap(group => group.rules || []);
  }

  function operatorNeedsValue(operator) {
    return !FILTER_OPERATORS.find(entry => entry.id === operator)?.noValue;
  }

  function isActiveFilterRule(rule) {
    if (!rule?.columnId || !rule?.operator) return false;
    return !operatorNeedsValue(rule.operator) || String(rule.value ?? "").trim() !== "";
  }

  function activeFilterRules() {
    return allFilterRules().filter(isActiveFilterRule);
  }

  function advancedFilterColumnIds() {
    return [...new Set(activeFilterRules()
      .map(rule => rule.columnId)
      .filter(columnId => columnId && !columnId.startsWith("__")))]
      .slice(0, MAX_ADVANCED_FILTERS);
  }

  function columnForFilter(columnId) {
    if (columnId === "__name__") return { id: "__name__", title: "Nome do item", type: "name" };
    if (columnId === "__group__") return { id: "__group__", title: "Grupo do Monday", type: "group" };
    return state.columns.find(column => String(column.id) === String(columnId)) || null;
  }

  function filterValueFor(item, columnId) {
    if (columnId === "__name__") return item.name || "";
    if (columnId === "__group__") return item.group_title || "";
    return valueFor(item, columnId).text || "";
  }

  function comparableNumber(value) {
    const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function comparableDate(value) {
    const timestamp = Date.parse(String(value ?? "").trim());
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function matchesFilterRule(item, rule) {
    if (!isActiveFilterRule(rule)) return true;
    if (!rule.columnId.startsWith("__") && !state.loadedFilterIds.includes(rule.columnId)) return true;
    const actualRaw = filterValueFor(item, rule.columnId);
    const expectedRaw = String(rule.value ?? "");
    const actual = norm(actualRaw);
    const expected = norm(expectedRaw);
    if (rule.operator === "is_empty") return !String(actualRaw ?? "").trim();
    if (rule.operator === "is_not_empty") return Boolean(String(actualRaw ?? "").trim());
    if (rule.operator === "contains") return actual.includes(expected);
    if (rule.operator === "not_contains") return !actual.includes(expected);
    if (rule.operator === "equals") return actual === expected;
    if (rule.operator === "not_equals") return actual !== expected;
    if (["greater", "greater_equal", "less", "less_equal"].includes(rule.operator)) {
      const left = comparableNumber(actualRaw);
      const right = comparableNumber(expectedRaw);
      if (left === null || right === null) return false;
      if (rule.operator === "greater") return left > right;
      if (rule.operator === "greater_equal") return left >= right;
      if (rule.operator === "less") return left < right;
      return left <= right;
    }
    if (["before", "after"].includes(rule.operator)) {
      const left = comparableDate(actualRaw);
      const right = comparableDate(expectedRaw);
      if (left === null || right === null) return false;
      return rule.operator === "before" ? left < right : left > right;
    }
    return true;
  }

  function matchesAdvancedFilters(item) {
    const activeGroups = state.advancedFilterGroups.map(group => ({
      ...group,
      rules: (group.rules || []).filter(isActiveFilterRule)
    })).filter(group => group.rules.length);
    if (!activeGroups.length) return true;
    const results = activeGroups.map(group => {
      const values = group.rules.map(rule => matchesFilterRule(item, rule));
      return group.operator === "or" ? values.some(Boolean) : values.every(Boolean);
    });
    return state.filterGroupJoin === "or" ? results.some(Boolean) : results.every(Boolean);
  }

  function filterRuleLocation(ruleId) {
    for (const group of state.advancedFilterGroups) {
      const rule = group.rules.find(entry => entry.id === ruleId);
      if (rule) return { group, rule };
    }
    return null;
  }

  function uniqueFilterValues(columnId) {
    return [...new Set(state.items.map(item => String(filterValueFor(item, columnId) || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .slice(0, 100);
  }

  function renderFilterValue(rule) {
    if (!operatorNeedsValue(rule.operator)) return '<span class="gv-filter-no-value">Nenhum valor necessário</span>';
    const column = columnForFilter(rule.columnId);
    const inputType = ["date", "timeline", "week"].includes(column?.type) && ["before", "after", "equals", "not_equals"].includes(rule.operator)
      ? "date" : (["numbers", "rating"].includes(column?.type) && ["greater", "greater_equal", "less", "less_equal", "equals", "not_equals"].includes(rule.operator) ? "number" : "text");
    const listId = `gv-values-${rule.id}`;
    const options = uniqueFilterValues(rule.columnId).map(value => `<option value="${esc(value)}"></option>`).join("");
    return `<span class="gv-filter-value"><input type="${inputType}" data-filter-field="value" data-rule-id="${esc(rule.id)}" value="${esc(rule.value)}" ${inputType === "text" ? `list="${listId}"` : ""} placeholder="Valor"><datalist id="${listId}">${options}</datalist></span>`;
  }

  function renderAdvancedFilters() {
    if (!state.advancedFilterGroups.length) resetAdvancedFilters();
    const columnOptions = [
      { id: "__name__", title: "Nome do item", type: "item" },
      { id: "__group__", title: "Grupo do Monday", type: "grupo" },
      ...state.columns
    ];
    const html = [];
    state.advancedFilterGroups.forEach((group, groupIndex) => {
      if (groupIndex > 0) {
        html.push(`<div class="gv-filter-group-join"><span>Combinar grupo anterior com</span><select data-filter-group-join aria-label="Combinação entre grupos"><option value="and" ${state.filterGroupJoin === "and" ? "selected" : ""}>E</option><option value="or" ${state.filterGroupJoin === "or" ? "selected" : ""}>OU</option></select></div>`);
      }
      html.push(`<section class="gv-filter-group" data-filter-group-id="${esc(group.id)}">
        <div class="gv-filter-group-head"><strong>Grupo ${groupIndex + 1}</strong><label>Combinar regras com <select data-filter-group-operator="${esc(group.id)}"><option value="and" ${group.operator === "and" ? "selected" : ""}>E</option><option value="or" ${group.operator === "or" ? "selected" : ""}>OU</option></select></label>${state.advancedFilterGroups.length > 1 ? `<button type="button" data-remove-filter-group="${esc(group.id)}" aria-label="Excluir grupo">Excluir grupo</button>` : ""}</div>`);
      group.rules.forEach(rule => {
        html.push(`<div class="gv-filter-rule" data-rule-id="${esc(rule.id)}">
          <select data-filter-field="column" data-rule-id="${esc(rule.id)}" aria-label="Coluna do filtro">${columnOptions.map(column => `<option value="${esc(column.id)}" ${column.id === rule.columnId ? "selected" : ""}>${esc(column.title)}</option>`).join("")}</select>
          <select data-filter-field="operator" data-rule-id="${esc(rule.id)}" aria-label="Condição do filtro">${FILTER_OPERATORS.map(operator => `<option value="${operator.id}" ${operator.id === rule.operator ? "selected" : ""}>${esc(operator.label)}</option>`).join("")}</select>
          ${renderFilterValue(rule)}
          <button type="button" class="gv-filter-remove" data-remove-filter="${esc(rule.id)}" aria-label="Remover filtro">×</button>
        </div>`);
      });
      html.push("</section>");
    });
    $("gvFilterGroups").innerHTML = html.join("");
    $("gvAddFilter").disabled = allFilterRules().length >= MAX_ADVANCED_FILTERS;
    $("gvAddFilterGroup").disabled = allFilterRules().length >= MAX_ADVANCED_FILTERS;
  }

  function filtersNeedReload() {
    return advancedFilterColumnIds().some(columnId => !state.loadedFilterIds.includes(columnId));
  }

  function filteredItems() {
    const query = norm($("gvBusca").value);
    const group = $("gvGrupo").value;
    const person = $("gvPessoa").value;
    const order = $("gvOrdenar").value;
    const rows = state.items.filter(item => {
      const text = [item.name, item.group_title, ...state.visibleIds.map(id => valueFor(item, id).text)].join(" ");
      return (!group || item.group_title === group) && matchesPerson(item, person) && matchesAdvancedFilters(item) && (!query || norm(text).includes(query));
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
    const filterCount = Number(Boolean($("gvGrupo").value)) + activeFilterRules().length;
    $("gvFiltroLabel").textContent = filterCount ? `Filtro / ${filterCount}` : "Filtro";
    $("gvFiltroControl").classList.toggle("is-active", filterCount > 0);
    $("gvFilterResults").textContent = `Mostrando ${rows.length.toLocaleString("pt-BR")} de ${state.items.length.toLocaleString("pt-BR")} itens${filtersNeedReload() ? " · aplique para carregar colunas ocultas" : ""}`;
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

  function closeCreatePopover() {
    $("gvCreatePopover").hidden = true;
    $("gvCreateArrow").setAttribute("aria-expanded", "false");
  }

  function defaultCreateGroupId(preferredId = "") {
    const groups = Array.isArray(state.board?.groups) ? state.board.groups : [];
    if (groups.some(group => String(group.id) === String(preferredId))) return String(preferredId);
    const filteredGroup = $("gvGrupo").value;
    const current = groups.find(group => String(group.title) === String(filteredGroup));
    return String(current?.id || groups[0]?.id || "");
  }

  function renderCreateGroups() {
    const groups = Array.isArray(state.board?.groups) ? state.board.groups : [];
    $("gvCreateGroups").innerHTML = groups.length
      ? groups.map(group => `<button type="button" data-create-group="${esc(group.id)}"><i style="background:${groupColor(group.title)}"></i>${esc(group.title)}</button>`).join("")
      : '<small>Nenhum grupo disponível neste quadro.</small>';
    $("gvCreateItem").disabled = !groups.length;
    $("gvCreateArrow").disabled = !groups.length;
  }

  function openCreateDialog(groupId = "") {
    if (!state.board) return toast("Nenhum quadro está aberto.", true);
    const groups = Array.isArray(state.board.groups) ? state.board.groups : [];
    if (!groups.length) return toast("Este quadro não possui grupo disponível para criação.", true);
    $("gvCreateGroup").innerHTML = groups.map(group => `<option value="${esc(group.id)}">${esc(group.title)}</option>`).join("");
    $("gvCreateGroup").value = defaultCreateGroupId(groupId);
    $("gvCreateName").value = "";
    closeCreatePopover();
    $("gvCreateDialog").showModal();
    $("gvCreateName").focus();
  }

  function savedColumns(boardId) {
    try {
      const value = JSON.parse(localStorage.getItem(`gv-columns-${boardId}`) || "[]");
      return Array.isArray(value) ? value.slice(0, MAX_VISIBLE_COLUMNS) : [];
    } catch (_error) { return []; }
  }

  async function loadRemainingPages(boardId, cursor, token) {
    let nextCursor = cursor;
    let pagesRead = 1;
    try {
      while (nextCursor && pagesRead < 21 && token === state.loadToken) {
        const payload = await call("board_page", {
          board_id: Number(boardId),
          cursor: nextCursor,
          column_ids: state.visibleIds,
          filter_column_ids: advancedFilterColumnIds()
        });
        if (token !== state.loadToken) return;
        const knownIds = new Set(state.items.map(item => String(item.id)));
        const newItems = (Array.isArray(payload.items) ? payload.items : []).filter(item => !knownIds.has(String(item.id)));
        state.items.push(...newItems);
        nextCursor = payload.next_cursor || null;
        pagesRead += 1;
        $("gvStatus").textContent = nextCursor
          ? `Carregando ${state.items.length.toLocaleString("pt-BR")}...`
          : "Conectado";
        renderFilters();
        render();
      }
      if (nextCursor && token === state.loadToken) {
        $("gvStatus").textContent = "Parcial";
        toast("O quadro ultrapassou o limite seguro de 10.000 itens. Os primeiros itens foram exibidos.", true);
      } else if (token === state.loadToken) {
        renderAdvancedFilters();
      }
    } catch (error) {
      if (token !== state.loadToken) return;
      console.error(error);
      $("gvStatus").textContent = "Parcial";
      toast(`Os primeiros ${state.items.length.toLocaleString("pt-BR")} itens foram exibidos, mas o restante não carregou: ${error.message}`, true);
    }
  }

  async function loadBoard(boardId, columnIds = null, viewId = "") {
    const switchingBoard = state.board && String(state.board.id) !== String(boardId);
    if (switchingBoard) {
      resetAdvancedFilters();
      $("gvGrupo").value = "";
      $("gvPessoa").value = "";
    }
    const token = ++state.loadToken;
    $("gvStatus").textContent = "Carregando...";
    $("gvBoardContent").innerHTML = '<div class="gv-loading">Carregando quadro e colunas do Monday...</div>';
    document.querySelectorAll("[data-board-target]").forEach(element => element.classList.remove("is-active"));
    try {
      const payload = await call("board_data", {
        board_id: Number(boardId),
        column_ids: columnIds || savedColumns(boardId),
        filter_column_ids: advancedFilterColumnIds(),
        view_id: viewId || null
      });
      if (token !== state.loadToken) return;
      state.board = payload.board;
      state.columns = Array.isArray(payload.columns) ? payload.columns : [];
      state.views = Array.isArray(payload.views) ? payload.views : [];
      state.activeViewId = String(payload.active_view_id || "");
      state.visibleIds = Array.isArray(payload.selected_column_ids) ? payload.selected_column_ids : [];
      state.loadedFilterIds = [...new Set([...state.visibleIds, ...(Array.isArray(payload.loaded_filter_column_ids) ? payload.loaded_filter_column_ids : [])])];
      state.items = Array.isArray(payload.items) ? payload.items : [];
      state.collapsedGroups = new Set();
      state.groupLimits = new Map();
      localStorage.setItem(`gv-columns-${boardId}`, JSON.stringify(state.visibleIds));
      $("gvBoardTitle").textContent = payload.board.name;
      const activeView = state.views.find(view => String(view.id) === state.activeViewId);
      $("gvBoardSubtitle").textContent = activeView ? `Filtro salvo: ${activeView.name}` : "Edição interna das colunas do quadro";
      $("gvBoard").textContent = `${payload.board.name} · ${payload.board.id}`;
      $("gvTotal").textContent = Number(payload.board.items_count || state.items.length).toLocaleString("pt-BR");
      $("gvStatus").textContent = payload.next_cursor ? `Carregando ${state.items.length.toLocaleString("pt-BR")}...` : "Conectado";
      document.querySelectorAll("[data-board-id]").forEach(element => element.classList.toggle("is-active", String(element.dataset.boardId) === String(boardId)));
      renderFilters();
      renderColumnMenu();
      renderViews();
      renderCreateGroups();
      renderAdvancedFilters();
      render();
      if (payload.next_cursor) void loadRemainingPages(boardId, payload.next_cursor, token);
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

  function applyWorkspacePayload(payload) {
    state.boards = Array.isArray(payload?.boards) ? payload.boards : [];
    state.missingTargets = Array.isArray(payload?.missing_targets) ? payload.missing_targets : [];
    state.users = Array.isArray(payload?.users) ? payload.users : [];
    state.sortedUsers = state.users.slice().sort((a, b) => userLabel(a).localeCompare(userLabel(b), "pt-BR"));
    syncBoardMenu();
    renderFilters();
  }

  function cachedWorkspacePayload() {
    try {
      const cached = JSON.parse(localStorage.getItem(BOOTSTRAP_CACHE_KEY) || "null");
      if (!cached?.payload || Date.now() - Number(cached.at || 0) > BOOTSTRAP_CACHE_MS) return null;
      return cached.payload;
    } catch (_error) {
      return null;
    }
  }

  function cacheWorkspacePayload(payload) {
    try {
      localStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify({ at: Date.now(), payload }));
    } catch (_error) {}
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
      toast(result.audit_saved === false
        ? "Alteração salva no Monday, mas o registro de auditoria falhou. Verifique a migração SQL."
        : "Alteração salva e registrada na auditoria com sucesso.", result.audit_saved === false);
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

  async function createItem(event) {
    event.preventDefault();
    if (!state.board) return;
    const itemName = $("gvCreateName").value.replace(/\s+/g, " ").trim();
    const groupId = $("gvCreateGroup").value;
    const group = (state.board.groups || []).find(entry => String(entry.id) === String(groupId));
    if (!itemName) return toast("Digite o nome do novo título.", true);
    if (!group) return toast("Selecione um grupo válido.", true);
    if (!confirm(`Criar “${itemName}” no grupo “${group.title}” do Monday?`)) return;

    const button = $("gvCreateSubmit");
    button.disabled = true;
    button.textContent = "Criando...";
    try {
      const boardId = state.board.id;
      const viewId = state.activeViewId;
      const visibleIds = state.visibleIds.slice();
      const result = await call("create_item", {
        board_id: Number(boardId),
        group_id: groupId,
        item_name: itemName
      });
      $("gvCreateDialog").close();
      await loadBoard(boardId, visibleIds, viewId);
      toast(result.audit_saved === false
        ? `Título criado no Monday, mas o registro de auditoria falhou. Verifique a migração SQL.`
        : `Título “${result.item?.name || itemName}” criado e registrado na auditoria.`, result.audit_saved === false);
    } catch (error) {
      console.error(error);
      toast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "Criar título";
    }
  }

  function localDateValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function setDefaultAuditPeriod() {
    if ($("gvAuditFrom").value && $("gvAuditTo").value) return;
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    $("gvAuditFrom").value = localDateValue(from);
    $("gvAuditTo").value = localDateValue(to);
  }

  function formatDateTime(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString("pt-BR") : "—";
  }

  function actionLabel(action) {
    return ({
      criar_item: "Criação de título",
      alterar_coluna: "Alteração de coluna",
      alterar_nome: "Alteração de nome"
    })[action] || String(action || "Operação");
  }

  function formatAuditValue(value) {
    if (value === null || value === undefined) return "—";
    if (typeof value === "object" && "text" in value && String(value.text || "").trim()) return String(value.text);
    if (typeof value === "object") {
      try { return JSON.stringify(value); } catch (_error) { return String(value); }
    }
    return String(value);
  }

  function filteredAuditRows(type) {
    const user = $("gvAuditUser").value;
    const action = $("gvAuditAction").value;
    const rows = type === "changes" ? state.audit.changes : state.audit.accesses;
    return rows.filter(row => (!user || norm(row.usuario_email) === norm(user)) &&
      (type !== "changes" || !action || row.acao === action));
  }

  function renderAuditUsers() {
    const current = $("gvAuditUser").value;
    const people = new Map();
    [...state.audit.accesses, ...state.audit.changes].forEach(row => {
      const email = String(row.usuario_email || "").trim().toLowerCase();
      if (email && !people.has(email)) people.set(email, String(row.usuario_nome || email));
    });
    const options = [...people.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
    $("gvAuditUser").innerHTML = '<option value="">Todos os usuários</option>' +
      options.map(([email, name]) => `<option value="${esc(email)}">${esc(name)} · ${esc(email)}</option>`).join("");
    if (people.has(current)) $("gvAuditUser").value = current;
  }

  function renderAuditReport() {
    const accessRows = filteredAuditRows("accesses");
    const changeRows = filteredAuditRows("changes");
    $("gvAuditAccessCount").textContent = accessRows.length.toLocaleString("pt-BR");
    $("gvAuditAccessUsers").textContent = new Set(accessRows.map(row => row.usuario_email).filter(Boolean)).size.toLocaleString("pt-BR");
    $("gvAuditChangeCount").textContent = changeRows.length.toLocaleString("pt-BR");
    $("gvAuditChangeUsers").textContent = new Set(changeRows.map(row => row.usuario_email).filter(Boolean)).size.toLocaleString("pt-BR");
    $("gvAuditLimit").textContent = state.audit.truncated ? "Limite de 2.000 registros atingido." : "";
    document.querySelectorAll("[data-audit-tab]").forEach(button => button.classList.toggle("is-active", button.dataset.auditTab === state.audit.activeTab));

    const rows = state.audit.activeTab === "changes" ? changeRows : accessRows;
    if (!rows.length) {
      $("gvAuditTable").innerHTML = '<div class="gv-audit-empty">Nenhum registro encontrado para os filtros selecionados.</div>';
      return;
    }
    if (state.audit.activeTab === "accesses") {
      $("gvAuditTable").innerHTML = `<table class="gv-audit-table"><thead><tr><th>Data e hora</th><th>Usuário</th><th>E-mail</th><th>Evento</th><th>Quadro</th><th>Versão</th></tr></thead><tbody>${rows.map(row => `<tr>
        <td>${esc(formatDateTime(row.criado_em))}</td>
        <td>${esc(row.usuario_nome || "—")}</td>
        <td>${esc(row.usuario_email || "—")}</td>
        <td><span class="gv-audit-action">${esc(row.evento || "acesso")}</span></td>
        <td>${esc(row.quadro_nome || "Sistema")}<small>${esc(row.quadro_id || "")}</small></td>
        <td>${esc(row.build_id || "—")}</td>
      </tr>`).join("")}</tbody></table>`;
      return;
    }
    $("gvAuditTable").innerHTML = `<table class="gv-audit-table"><thead><tr><th>Data e hora</th><th>Usuário</th><th>Ação</th><th>Quadro</th><th>Item</th><th>Coluna</th><th>Valor anterior</th><th>Valor novo</th><th>Status</th></tr></thead><tbody>${rows.map(row => `<tr>
      <td>${esc(formatDateTime(row.criado_em))}</td>
      <td>${esc(row.usuario_nome || "—")}<small>${esc(row.usuario_email || "")}</small></td>
      <td><span class="gv-audit-action">${esc(actionLabel(row.acao))}</span></td>
      <td>${esc(row.quadro_nome || "—")}<small>${esc(row.quadro_id || "")}</small></td>
      <td>${esc(row.item_nome || "—")}<small>${esc(row.item_id || "")}</small></td>
      <td>${esc(row.coluna_nome || "—")}<small>${esc(row.coluna_id || "")}</small></td>
      <td><span class="gv-audit-value" title="${esc(formatAuditValue(row.valor_anterior))}">${esc(formatAuditValue(row.valor_anterior))}</span></td>
      <td><span class="gv-audit-value" title="${esc(formatAuditValue(row.valor_novo))}">${esc(formatAuditValue(row.valor_novo))}</span></td>
      <td>${esc(row.status || "—")}</td>
    </tr>`).join("")}</tbody></table>`;
  }

  async function loadAuditReport() {
    setDefaultAuditPeriod();
    const fromValue = $("gvAuditFrom").value;
    const toValue = $("gvAuditTo").value;
    if (!fromValue || !toValue) return toast("Informe o período do relatório.", true);
    const button = $("gvAuditApply");
    button.disabled = true;
    button.textContent = "Carregando...";
    $("gvAuditStatus").textContent = "Consultando registros de auditoria...";
    try {
      const payload = await call("audit_report", {
        from: new Date(`${fromValue}T00:00:00`).toISOString(),
        to: new Date(`${toValue}T23:59:59.999`).toISOString(),
        limit: 2000
      });
      state.audit.accesses = Array.isArray(payload.accesses) ? payload.accesses : [];
      state.audit.changes = Array.isArray(payload.changes) ? payload.changes : [];
      state.audit.truncated = Boolean(payload.truncated);
      state.audit.loaded = true;
      renderAuditUsers();
      renderAuditReport();
      $("gvAuditStatus").textContent = `${(state.audit.accesses.length + state.audit.changes.length).toLocaleString("pt-BR")} registro(s) consultado(s).`;
    } catch (error) {
      console.error(error);
      $("gvAuditStatus").textContent = error.message;
      $("gvAuditTable").innerHTML = `<div class="gv-audit-empty">${esc(error.message)}</div>`;
      toast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "Atualizar relatório";
    }
  }

  function openAuditReport() {
    document.body.classList.add("gv-report-mode");
    $("gvAuditView").hidden = false;
    $("gvBoardTitle").textContent = "Relatórios de Auditoria";
    $("gvBoardSubtitle").textContent = "Acessos e alterações registrados por usuário";
    document.querySelectorAll("[data-board-target]").forEach(element => element.classList.remove("is-active"));
    $("gvAuditReports").classList.add("is-active");
    setDefaultAuditPeriod();
    if (!state.audit.loaded) void loadAuditReport();
  }

  function closeAuditReport() {
    document.body.classList.remove("gv-report-mode");
    $("gvAuditView").hidden = true;
    $("gvAuditReports").classList.remove("is-active");
    if (state.board) {
      $("gvBoardTitle").textContent = state.board.name;
      const activeView = state.views.find(view => String(view.id) === state.activeViewId);
      $("gvBoardSubtitle").textContent = activeView ? `Filtro salvo: ${activeView.name}` : "Edição interna das colunas do quadro";
      document.querySelectorAll("[data-board-id]").forEach(element => element.classList.toggle("is-active", String(element.dataset.boardId) === String(state.board.id)));
    }
  }

  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportAuditCsv() {
    const rows = filteredAuditRows(state.audit.activeTab);
    if (!rows.length) return toast("Não há registros para exportar.", true);
    const access = state.audit.activeTab === "accesses";
    const headers = access
      ? ["Data e hora", "Usuário", "E-mail", "Evento", "Quadro", "Quadro ID", "Versão"]
      : ["Data e hora", "Usuário", "E-mail", "Ação", "Quadro", "Quadro ID", "Item", "Item ID", "Coluna", "Coluna ID", "Valor anterior", "Valor novo", "Status"];
    const data = rows.map(row => access
      ? [formatDateTime(row.criado_em), row.usuario_nome, row.usuario_email, row.evento, row.quadro_nome, row.quadro_id, row.build_id]
      : [formatDateTime(row.criado_em), row.usuario_nome, row.usuario_email, actionLabel(row.acao), row.quadro_nome, row.quadro_id, row.item_nome, row.item_id, row.coluna_nome, row.coluna_id, formatAuditValue(row.valor_anterior), formatAuditValue(row.valor_novo), row.status]);
    const csv = "\ufeff" + [headers, ...data].map(line => line.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio_${access ? "acessos" : "alteracoes"}_${$("gvAuditFrom").value}_${$("gvAuditTo").value}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function logAccessOnce() {
    const key = "gv-audit-access-logged-v2";
    if (sessionStorage.getItem(key)) return;
    try {
      const result = await call("log_access", {
        event_type: "acesso_sistema",
        board_id: ROOT_BOARD_ID,
        board_name: state.board?.name || "Validação de Materiais",
        page: `${location.pathname}${location.search}`,
        build_id: window.APP_CONFIG.BUILD_ID
      });
      if (result.audit_saved) sessionStorage.setItem(key, "1");
    } catch (error) {
      console.error("Acesso não registrado", error);
    }
  }

  function bindInteractions() {
    $("gvAuditReports").addEventListener("click", openAuditReport);
    $("gvAuditBack").addEventListener("click", closeAuditReport);
    $("gvAuditApply").addEventListener("click", loadAuditReport);
    $("gvAuditExport").addEventListener("click", exportAuditCsv);
    ["gvAuditUser", "gvAuditAction"].forEach(id => $(id).addEventListener("change", renderAuditReport));
    document.querySelectorAll("[data-audit-tab]").forEach(button => button.addEventListener("click", () => {
      state.audit.activeTab = button.dataset.auditTab;
      $("gvAuditAction").disabled = state.audit.activeTab !== "changes";
      renderAuditReport();
    }));
    ["gvBusca", "gvGlobalBusca"].forEach(id => $(id).addEventListener("input", event => {
      const other = id === "gvBusca" ? $("gvGlobalBusca") : $("gvBusca");
      other.value = event.target.value;
      resetLimitsAndRender();
    }));
    ["gvGrupo", "gvPessoa", "gvOrdenar", "gvAgrupar"].forEach(id => $(id).addEventListener("change", resetLimitsAndRender));

    $("gvAddFilter").addEventListener("click", () => {
      if (allFilterRules().length >= MAX_ADVANCED_FILTERS) return toast(`Use no máximo ${MAX_ADVANCED_FILTERS} filtros por vez.`, true);
      if (!state.advancedFilterGroups.length) resetAdvancedFilters();
      state.advancedFilterGroups[state.advancedFilterGroups.length - 1].rules.push(newFilterRule());
      renderAdvancedFilters();
    });
    $("gvAddFilterGroup").addEventListener("click", () => {
      if (allFilterRules().length >= MAX_ADVANCED_FILTERS) return toast(`Use no máximo ${MAX_ADVANCED_FILTERS} filtros por vez.`, true);
      state.advancedFilterGroups.push(newFilterGroup());
      renderAdvancedFilters();
    });
    $("gvFilterGroups").addEventListener("input", event => {
      const input = event.target.closest('[data-filter-field="value"]');
      if (!input) return;
      const location = filterRuleLocation(input.dataset.ruleId);
      if (location) location.rule.value = input.value;
      resetLimitsAndRender();
    });
    $("gvFilterGroups").addEventListener("change", event => {
      const field = event.target.closest("[data-filter-field]");
      if (field) {
        const location = filterRuleLocation(field.dataset.ruleId);
        if (!location) return;
        if (field.dataset.filterField === "column") {
          location.rule.columnId = field.value;
          location.rule.value = "";
        } else if (field.dataset.filterField === "operator") {
          location.rule.operator = field.value;
        }
        renderAdvancedFilters();
        resetLimitsAndRender();
        return;
      }
      const groupOperator = event.target.closest("[data-filter-group-operator]");
      if (groupOperator) {
        const group = state.advancedFilterGroups.find(entry => entry.id === groupOperator.dataset.filterGroupOperator);
        if (group) group.operator = groupOperator.value === "or" ? "or" : "and";
        resetLimitsAndRender();
        return;
      }
      if (event.target.matches("[data-filter-group-join]")) {
        state.filterGroupJoin = event.target.value === "or" ? "or" : "and";
        resetLimitsAndRender();
      }
    });
    $("gvFilterGroups").addEventListener("click", event => {
      const removeRule = event.target.closest("[data-remove-filter]");
      if (removeRule) {
        const location = filterRuleLocation(removeRule.dataset.removeFilter);
        if (location) location.group.rules = location.group.rules.filter(rule => rule.id !== location.rule.id);
        if (location && !location.group.rules.length) location.group.rules.push(newFilterRule());
        renderAdvancedFilters();
        resetLimitsAndRender();
        return;
      }
      const removeGroup = event.target.closest("[data-remove-filter-group]");
      if (removeGroup) {
        state.advancedFilterGroups = state.advancedFilterGroups.filter(group => group.id !== removeGroup.dataset.removeFilterGroup);
        if (!state.advancedFilterGroups.length) resetAdvancedFilters();
        renderAdvancedFilters();
        resetLimitsAndRender();
      }
    });
    $("gvApplyFilters").addEventListener("click", () => {
      if (!state.board) return;
      loadBoard(state.board.id, state.visibleIds, state.activeViewId);
    });
    $("gvClearFilters").addEventListener("click", () => {
      $("gvGrupo").value = "";
      resetAdvancedFilters();
      renderAdvancedFilters();
      resetLimitsAndRender();
    });

    $("gvCreateItem").addEventListener("click", () => openCreateDialog());
    $("gvCreateArrow").addEventListener("click", event => {
      event.stopPropagation();
      const willOpen = $("gvCreatePopover").hidden;
      $("gvCreatePopover").hidden = !willOpen;
      $("gvCreateArrow").setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
    $("gvCreateGroups").addEventListener("click", event => {
      const button = event.target.closest("[data-create-group]");
      if (button) openCreateDialog(button.dataset.createGroup);
    });
    document.addEventListener("click", event => {
      if (!event.target.closest(".gv-create-wrap")) closeCreatePopover();
    });

    document.querySelectorAll("[data-board-target]").forEach(element => element.addEventListener("click", () => {
      const boardId = element.dataset.boardId;
      if (!boardId) return toast(`“${element.dataset.boardTarget}” não apareceu como quadro acessível na API. Verifique se é painel/pasta, o nome real ou a permissão do token.`, true);
      closeAuditReport();
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
      $("gvPessoa").value = ""; $("gvOrdenar").value = "board";
      resetAdvancedFilters(); renderAdvancedFilters(); resetLimitsAndRender();
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
    $("gvCreateForm").addEventListener("submit", createItem);
    ["gvCreateClose", "gvCreateCancel"].forEach(id => $(id).addEventListener("click", () => $("gvCreateDialog").close()));
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      document.querySelectorAll("details[open]").forEach(details => { details.open = false; });
      closeCreatePopover();
      if ($("gvCreateDialog").open) $("gvCreateDialog").close();
      if ($("gvCellDialog").open) { $("gvCellDialog").close(); state.cell = null; }
    });

    document.querySelectorAll([".gv-global-actions button", ".gv-side-icon", ".gv-boardnav button", ".gv-nav-item:not([data-board-target]):not(#gvAuditReports)", ".gv-star", ".gv-board-actions > button:not(.gv-logout)"].join(","))
      .forEach(button => button.addEventListener("click", () => toast(`${button.title || button.textContent.trim() || "Opção"}: este é um produto do portal Monday, não uma função de quadro disponível pela integração.`, true)));
    window.GV_APP_READY = true;
    $("gvControlsStatus").textContent = "V2.4 · auditoria ativa";
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
    void logAccessOnce();

    const name = document.querySelector("[data-user-name]")?.textContent || user.email || "U";
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    const initials = ((parts[0]?.[0] || "U") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
    document.querySelectorAll("[data-user-avatar]").forEach(avatar => { avatar.textContent = initials; });

    const cached = cachedWorkspacePayload();
    if (cached) applyWorkspacePayload(cached);

    const initialLoad = loadBoard(ROOT_BOARD_ID);
    try {
      const payload = await call("workspace_bootstrap");
      applyWorkspacePayload(payload);
      cacheWorkspacePayload(payload);
      if (state.missingTargets.length) {
        toast(`${state.missingTargets.length} item(ns) do menu não apareceram como quadros na API: ${state.missingTargets.join(", ")}.`, true);
      }
    } catch (error) {
      console.error(error);
      toast("O quadro principal foi aberto, mas a atualização do menu não terminou. Tente atualizar mais tarde.", true);
    }
    await initialLoad;
  }

  document.addEventListener("DOMContentLoaded", start);
})();
