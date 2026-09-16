(function () {
  "use strict";

  window.GV_SCRIPT_LOADED = true;

  const BOARD_ID = Number(window.APP_CONFIG.BOARD_ID);
  const GROUP_PAGE_SIZE = 30;
  const GROUP_COLORS = ["#579bfc", "#00c875", "#fdab3d", "#a25ddc", "#e2445c", "#0086c0", "#cab641", "#784bd1"];

  let state = {
    items: [],
    users: [],
    sortedUsers: [],
    columns: null,
    board: null,
    collapsedGroups: new Set(),
    groupLimits: new Map(),
    view: "all"
  };

  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
  const norm = v => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  function groupColor(name) {
    const normalized = norm(name);
    if (normalized.startsWith("a liberar")) return "#c4c4c4";
    if (normalized.includes("liberado para validacao")) return "#fdab3d";
    if (normalized.includes("revalid")) return "#ff642e";
    if (normalized.includes("em ajuste")) return "#579bfc";
    if (normalized.includes("validado")) return "#00c875";
    if (normalized.includes("pausado")) return "#e2445c";
    if (normalized.includes("aguardando")) return "#a25ddc";
    if (normalized.includes("todos os itens")) return "#579bfc";

    let hash = 0;
    for (const ch of String(name || "")) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
    return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
  }

  function toast(msg, error = false) {
    const el = $("gvToast");
    el.textContent = msg;
    el.className = "gv-toast" + (error ? " error" : "");
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 5000);
  }

  function mensagemIntegracao(payload, status) {
    const recebida = String(payload?.error || payload?.message || "").trim();

    if (/^[a-f0-9]{48,}$/i.test(recebida)) {
      return `A API do Monday devolveu uma falha interna (referência ${recebida.slice(0, 12)}…). ` +
        "Verifique o token e os logs da função monday-responsaveis.";
    }

    if (recebida) return recebida;
    if (status === 401) return "Sua sessão expirou ou não foi autorizada. Entre novamente.";
    if (status === 404) return "A função monday-responsaveis não foi encontrada. Publique novamente a Edge Function.";
    if (status >= 500) return "A integração com o Monday falhou no servidor. Consulte os logs da Edge Function.";
    return `Não foi possível carregar os dados (HTTP ${status}).`;
  }

  async function call(action, extra = {}) {
    const { data, error } = await window.appSupabase.auth.getSession();
    if (error || !data?.session?.access_token) throw new Error("Sessão expirada. Entre novamente.");

    let res;
    try {
      res = await fetch(`${window.APP_CONFIG.SUPABASE_URL}/functions/v1/monday-responsaveis`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
          apikey: window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY
        },
        body: JSON.stringify({ action, board_id: BOARD_ID, ...extra })
      });
    } catch (error) {
      console.error("Falha de rede ao chamar monday-responsaveis", error);
      throw new Error("Não foi possível acessar a integração. Confira a publicação da Edge Function e a conexão.");
    }

    const raw = await res.text();
    let payload = null;
    if (raw) {
      try { payload = JSON.parse(raw); }
      catch (error) { console.error("Resposta não JSON da integração", { status: res.status, error }); }
    }

    if (!res.ok || payload?.ok === false) throw new Error(mensagemIntegracao(payload, res.status));
    if (!payload || typeof payload !== "object") {
      throw new Error("A integração respondeu em um formato inválido. Publique novamente a Edge Function.");
    }
    return payload;
  }

  function userLabel(user) {
    const name = String(user?.name || "").trim();
    const email = String(user?.email || "").trim();
    return email && norm(name) !== norm(email) ? `${name} · ${email}` : (name || email);
  }

  function userOptions(selectedId) {
    const base = ['<option value="">Sem responsável</option>'];
    state.sortedUsers.forEach(user => {
      base.push(`<option value="${esc(user.id)}" ${String(selectedId) === String(user.id) ? "selected" : ""}>${esc(userLabel(user))}</option>`);
    });
    return base.join("");
  }

  function currentId(list) {
    return Array.isArray(list) && list.length ? String(list[0].id) : "";
  }

  function matchesPerson(item, id) {
    if (!id) return true;
    return [...(item.gestor_people || []), ...(item.revisor_people || [])].some(person => String(person.id) === String(id));
  }

  function matchesView(item) {
    const hasGestor = Boolean(currentId(item.gestor_people));
    const hasRevisor = Boolean(currentId(item.revisor_people));
    if (state.view === "missing-gestor") return !hasGestor;
    if (state.view === "missing-revisor") return !hasRevisor;
    if (state.view === "incomplete") return !hasGestor || !hasRevisor;
    return true;
  }

  function filtrar() {
    const q = norm($("gvBusca").value);
    const grupo = $("gvGrupo").value;
    const pessoa = $("gvPessoa").value;
    const order = $("gvOrdenar").value;
    const rows = state.items.filter(item =>
      (!grupo || item.group_title === grupo) &&
      matchesPerson(item, pessoa) &&
      matchesView(item) &&
      (!q || norm(`${item.name} ${item.group_title} ${item.gestor_text} ${item.revisor_text}`).includes(q))
    );

    if (order === "name-asc") rows.sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
    if (order === "name-desc") rows.sort((a, b) => String(b.name).localeCompare(String(a.name), "pt-BR"));
    if (order === "group") rows.sort((a, b) => String(a.group_title).localeCompare(String(b.group_title), "pt-BR") || String(a.name).localeCompare(String(b.name), "pt-BR"));
    return rows;
  }

  function updateToolLabels() {
    const filterCount = [$("gvGrupo").value, $("gvPessoa").value].filter(Boolean).length;
    $("gvFiltroLabel").textContent = filterCount ? `Filtro / ${filterCount}` : "Filtro";
    $("gvFiltroControl").classList.toggle("is-active", Boolean(filterCount));

    const order = $("gvOrdenar").value;
    $("gvOrdenarLabel").textContent = order === "board" ? "Ordenar" : "Ordenar / 1";
    $("gvOrdenar").closest(".gv-tool-control").classList.toggle("is-active", order !== "board");

    const hidden = [$("gvHideGestor"), $("gvHideRevisor"), $("gvHideAcao")].filter(input => !input.checked).length;
    $("gvOcultarLabel").textContent = hidden ? `Ocultar / ${hidden}` : "Ocultar";
  }

  function render() {
    const rows = filtrar();
    $("gvExibidos").textContent = rows.length.toLocaleString("pt-BR");
    $("gvBoardCount").textContent = `${rows.length.toLocaleString("pt-BR")} ${rows.length === 1 ? "item" : "itens"}`;
    updateToolLabels();

    const hideGestor = !$("gvHideGestor").checked;
    const hideRevisor = !$("gvHideRevisor").checked;
    const hideAcao = !$("gvHideAcao").checked;
    const grouping = $("gvAgrupar").value;
    const groups = new Map();

    rows.forEach(item => {
      const key = grouping === "none" ? "Todos os itens" : (item.group_title || "Sem grupo");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    const html = [];
    groups.forEach((items, groupName) => {
      const color = groupColor(groupName);
      const collapsed = state.collapsedGroups.has(groupName);
      const limit = state.groupLimits.get(groupName) || GROUP_PAGE_SIZE;
      const visibleItems = items.slice(0, limit);
      const remaining = Math.max(0, items.length - visibleItems.length);

      html.push(`
        <section class="gv-monday-group" style="--group-color:${color}" data-group="${esc(groupName)}">
          <button class="gv-group-toggle" type="button" data-group="${esc(groupName)}" aria-expanded="${collapsed ? "false" : "true"}">
            <span class="gv-group-chevron ${collapsed ? "is-collapsed" : ""}">⌄</span>
            <span class="gv-group-title">${esc(groupName)}</span>
            <span class="gv-group-count">${items.length.toLocaleString("pt-BR")} ${items.length === 1 ? "material" : "materiais"}</span>
          </button>
          <div class="gv-group-body ${collapsed ? "is-collapsed" : ""}">
            <div class="gv-group-table-scroll">
              <table class="gv-group-table">
                <thead><tr>
                  <th class="gv-col-item">Material</th>
                  <th class="${hideGestor ? "is-hidden" : ""}">Gestor de Validação</th>
                  <th class="${hideRevisor ? "is-hidden" : ""}">Revisor Validador</th>
                  <th class="gv-col-action ${hideAcao ? "is-hidden" : ""}">Ação</th>
                </tr></thead><tbody>`);

      visibleItems.forEach(item => {
        const gestorId = currentId(item.gestor_people);
        const revisorId = currentId(item.revisor_people);
        html.push(`
          <tr class="gv-data-row" data-id="${esc(item.id)}" data-g0="${esc(gestorId)}" data-r0="${esc(revisorId)}">
            <td class="gv-item-cell">
              <span class="gv-item-name">${esc(item.name)}</span>
              <span class="gv-current">ID ${esc(item.id)}</span>
            </td>
            <td class="${hideGestor ? "is-hidden" : ""}">
              <select class="gv-row-select gv-gestor" aria-label="Gestor de ${esc(item.name)}">${userOptions(gestorId)}</select>
              <span class="gv-current">Atual: ${esc(item.gestor_text || "Sem responsável")}</span>
            </td>
            <td class="${hideRevisor ? "is-hidden" : ""}">
              <select class="gv-row-select gv-revisor" aria-label="Revisor de ${esc(item.name)}">${userOptions(revisorId)}</select>
              <span class="gv-current">Atual: ${esc(item.revisor_text || "Sem responsável")}</span>
            </td>
            <td class="${hideAcao ? "is-hidden" : ""}"><button type="button" class="gv-save" disabled>Salvar no Monday</button></td>
          </tr>`);
      });

      html.push("</tbody></table></div>");
      if (remaining > 0) {
        const next = Math.min(items.length, limit + GROUP_PAGE_SIZE);
        html.push(`<button class="gv-show-more" type="button" data-group="${esc(groupName)}" data-next="${next}">Mostrar mais ${Math.min(GROUP_PAGE_SIZE, remaining).toLocaleString("pt-BR")}<span>${visibleItems.length.toLocaleString("pt-BR")} de ${items.length.toLocaleString("pt-BR")}</span></button>`);
      }
      html.push("</div></section>");
    });

    $("gvBoardContent").innerHTML = html.join("") || '<div class="gv-empty">Nenhum item encontrado com os filtros atuais.</div>';
  }

  function renderSelectors() {
    const currentGroup = $("gvGrupo").value;
    const currentPerson = $("gvPessoa").value;
    const boardGroups = Array.isArray(state.board?.groups) ? state.board.groups : [];
    const groups = boardGroups.length
      ? boardGroups.map(group => [String(group.id), group.title || "Sem grupo"])
      : [...new Map(state.items.filter(item => item.group_id).map(item => [String(item.group_id), item.group_title || "Sem grupo"])).entries()];
    const titles = [...new Set(state.items.map(item => item.group_title).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));

    $("gvGrupo").innerHTML = '<option value="">Todos os grupos</option>' + titles.map(title => `<option value="${esc(title)}">${esc(title)}</option>`).join("");
    if (titles.includes(currentGroup)) $("gvGrupo").value = currentGroup;

    $("gvPessoa").innerHTML = '<option value="">Todas</option>' + state.sortedUsers.map(user => `<option value="${esc(user.id)}">${esc(userLabel(user))}</option>`).join("");
    if (state.sortedUsers.some(user => String(user.id) === String(currentPerson))) $("gvPessoa").value = currentPerson;

    $("gvCreateGroup").innerHTML = '<option value="">Selecione um grupo</option>' + groups.map(([id, title]) => `<option value="${esc(id)}">${esc(title)}</option>`).join("");
  }

  async function carregar() {
    $("gvStatus").textContent = "Carregando...";
    $("gvBoard").textContent = "Carregando...";
    $("gvTotal").textContent = "0";
    $("gvExibidos").textContent = "0";
    $("gvBoardCount").textContent = "0 itens";
    $("gvAtualizar").disabled = true;

    try {
      const payload = await call("bootstrap");
      if (!payload.board?.id || !Array.isArray(payload.items) || !Array.isArray(payload.users) || !payload.columns?.gestor || !payload.columns?.revisor) {
        throw new Error("A integração retornou dados incompletos. Publique novamente a Edge Function.");
      }
      state = {
        ...payload,
        items: payload.items.slice(),
        sortedUsers: payload.users.slice().sort((a, b) => userLabel(a).localeCompare(userLabel(b), "pt-BR")),
        collapsedGroups: new Set(),
        groupLimits: new Map(),
        view: state.view || "all"
      };
      $("gvBoard").textContent = `${payload.board.name} · ${payload.board.id}`;
      $("gvTotal").textContent = payload.items.length.toLocaleString("pt-BR");
      $("gvStatus").textContent = "Conectado";
      renderSelectors();
      render();
    } catch (error) {
      console.error(error);
      $("gvStatus").textContent = "Erro";
      $("gvBoard").textContent = "Não carregado";
      const message = error?.message || "Falha inesperada ao carregar os dados.";
      $("gvBoardContent").innerHTML = `<div class="gv-empty gv-empty-error">${esc(message)}</div>`;
      toast(message, true);
    } finally {
      $("gvAtualizar").disabled = false;
    }
  }

  function checkRow(row) {
    const gestor = row.querySelector(".gv-gestor").value;
    const revisor = row.querySelector(".gv-revisor").value;
    const changed = gestor !== row.dataset.g0 || revisor !== row.dataset.r0;
    row.classList.toggle("gv-changed", changed);
    row.querySelector(".gv-save").disabled = !changed;
  }

  async function salvar(row) {
    const button = row.querySelector(".gv-save");
    const itemId = row.dataset.id;
    const gestor = row.querySelector(".gv-gestor").value;
    const revisor = row.querySelector(".gv-revisor").value;
    if (!confirm("Confirmar alteração dos responsáveis deste item diretamente no Monday?")) return;

    button.disabled = true;
    button.textContent = "Salvando...";
    try {
      const payload = await call("update", {
        item_id: itemId,
        gestor_column_id: state.columns.gestor.id,
        revisor_column_id: state.columns.revisor.id,
        gestor_user_id: gestor,
        revisor_user_id: revisor
      });
      const values = Object.fromEntries((payload.item?.column_values || []).map(column => [column.id, column]));
      const item = state.items.find(candidate => String(candidate.id) === String(itemId));
      if (item) {
        const gestorColumn = values[state.columns.gestor.id];
        const revisorColumn = values[state.columns.revisor.id];
        item.gestor_text = gestorColumn?.text || "";
        item.gestor_people = gestorColumn?.persons_and_teams || [];
        item.revisor_text = revisorColumn?.text || "";
        item.revisor_people = revisorColumn?.persons_and_teams || [];
      }
      toast("Responsáveis atualizados no Monday com sucesso.");
      render();
    } catch (error) {
      console.error(error);
      toast(error.message, true);
      button.disabled = false;
      button.textContent = "Salvar no Monday";
    }
  }

  async function criarMaterial(event) {
    event.preventDefault();
    const itemName = $("gvCreateName").value.trim();
    const groupId = $("gvCreateGroup").value;
    if (!itemName || !groupId) return;

    const button = $("gvCreateSubmit");
    button.disabled = true;
    button.textContent = "Criando...";
    try {
      await call("create", { item_name: itemName, group_id: groupId });
      $("gvCreateDialog").close();
      $("gvCreateForm").reset();
      toast("Material criado no Monday com sucesso.");
      await carregar();
    } catch (error) {
      console.error(error);
      toast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "Criar no Monday";
    }
  }

  function resetLimitsAndRender() {
    state.groupLimits = new Map();
    render();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    let user;
    try {
      if (typeof window.protegerPagina !== "function") {
        throw new Error("O módulo de autenticação não foi carregado. Atualize a pasta js completa.");
      }
      user = await window.protegerPagina();
    } catch (error) {
      console.error("Falha ao iniciar a interface", error);
      const message = error?.message || "Não foi possível iniciar a interface.";
      $("gvStatus").textContent = "Erro de inicialização";
      $("gvBoardContent").innerHTML = `<div class="gv-empty gv-empty-error gv-startup-error">${esc(message)}</div>`;
      toast(message, true);
      return;
    }
    if (!user) return;

    const name = document.querySelector("[data-user-name]")?.textContent || user?.email || "U";
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    const initials = ((parts[0]?.[0] || "U") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
    document.querySelectorAll("[data-user-avatar]").forEach(avatar => { avatar.textContent = initials; });

    $("gvBusca").addEventListener("input", () => {
      $("gvGlobalBusca").value = $("gvBusca").value;
      resetLimitsAndRender();
    });
    $("gvGlobalBusca").addEventListener("input", () => {
      $("gvBusca").value = $("gvGlobalBusca").value;
      resetLimitsAndRender();
    });
    ["gvGrupo", "gvPessoa", "gvOrdenar", "gvAgrupar"].forEach(id => $(id).addEventListener("change", resetLimitsAndRender));
    ["gvHideGestor", "gvHideRevisor", "gvHideAcao"].forEach(id => $(id).addEventListener("change", render));

    document.querySelectorAll("[data-view]").forEach(tab => tab.addEventListener("click", () => {
      state.view = tab.dataset.view;
      document.querySelectorAll("[data-view]").forEach(candidate => candidate.classList.toggle("is-active", candidate === tab));
      resetLimitsAndRender();
    }));

    $("gvCriar").addEventListener("click", () => {
      if (!state.board) return toast("Aguarde o carregamento do quadro.", true);
      $("gvCreateDialog").showModal();
      $("gvCreateName").focus();
    });
    $("gvCreateClose").addEventListener("click", () => $("gvCreateDialog").close());
    $("gvCreateCancel").addEventListener("click", () => $("gvCreateDialog").close());
    $("gvCreateForm").addEventListener("submit", criarMaterial);
    $("gvAtualizar").addEventListener("click", carregar);
    $("gvLimpar").addEventListener("click", () => {
      $("gvBusca").value = "";
      $("gvGlobalBusca").value = "";
      $("gvGrupo").value = "";
      $("gvPessoa").value = "";
      $("gvOrdenar").value = "board";
      state.view = "all";
      document.querySelectorAll("[data-view]").forEach(tab => tab.classList.toggle("is-active", tab.dataset.view === "all"));
      resetLimitsAndRender();
    });
    $("gvExpandir").addEventListener("click", () => { state.collapsedGroups.clear(); render(); });
    $("gvRecolher").addEventListener("click", () => {
      const names = $("gvAgrupar").value === "none" ? ["Todos os itens"] : [...new Set(filtrar().map(item => item.group_title || "Sem grupo"))];
      state.collapsedGroups = new Set(names);
      render();
    });

    $("gvBoardContent").addEventListener("change", event => {
      if (event.target.matches(".gv-row-select")) checkRow(event.target.closest("tr"));
    });
    $("gvBoardContent").addEventListener("click", event => {
      const toggle = event.target.closest(".gv-group-toggle");
      if (toggle) {
        const groupName = toggle.dataset.group;
        if (state.collapsedGroups.has(groupName)) state.collapsedGroups.delete(groupName);
        else state.collapsedGroups.add(groupName);
        render();
        return;
      }
      const more = event.target.closest(".gv-show-more");
      if (more) {
        state.groupLimits.set(more.dataset.group, Number(more.dataset.next) || GROUP_PAGE_SIZE);
        render();
        return;
      }
      const button = event.target.closest(".gv-save");
      if (button) salvar(button.closest("tr"));
    });

    document.querySelectorAll([
      ".gv-global-actions button",
      ".gv-side-icon",
      ".gv-boardnav button",
      ".gv-star",
      ".gv-board-actions > button:not(.gv-logout)",
      ".gv-view-add"
    ].join(",")).forEach(button => {
      button.addEventListener("click", () => {
        if (button.classList.contains("gv-star")) {
          const active = button.textContent.trim() === "★";
          button.textContent = active ? "☆" : "★";
          toast(active ? "Quadro removido dos favoritos." : "Quadro marcado como favorito nesta sessão.");
          return;
        }

        const label = button.title || button.getAttribute("aria-label") || button.textContent.trim() || "Opção";
        if (button.classList.contains("gv-invite")) {
          toast("O acesso é controlado pelo login institucional do Supabase; convites não são enviados por esta tela.");
          return;
        }
        if (button.classList.contains("gv-view-add")) {
          toast("As quatro visualizações disponíveis já estão configuradas para a gestão de validadores.");
          return;
        }
        toast(`${label}: este atalho pertence ao ambiente completo do Monday e não altera este aplicativo.`);
      });
    });

    window.GV_APP_READY = true;
    carregar();
  });
})();
