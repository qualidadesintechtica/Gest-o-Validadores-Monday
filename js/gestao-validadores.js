(function () {
  "use strict";

  const BOARD_ID = Number(window.APP_CONFIG.BOARD_ID);
  const GROUP_PAGE_SIZE = 30;
  let state = {
    items: [],
    users: [],
    sortedUsers: [],
    columns: null,
    board: null,
    collapsedGroups: new Set(),
    groupLimits: new Map()
  };

  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
  const norm = v => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  const GROUP_COLORS = ["#579bfc", "#00c875", "#fdab3d", "#a25ddc", "#e2445c", "#0086c0", "#cab641", "#784bd1"];

  function groupColor(name) {
    const normalized = norm(name);
    if (normalized.startsWith("a liberar")) return "#c4c4c4";
    if (normalized.includes("liberado para validacao")) return "#fdab3d";
    if (normalized.includes("revalid")) return "#ff642e";
    if (normalized.includes("em ajuste")) return "#579bfc";
    if (normalized.includes("validado")) return "#00c875";
    if (normalized.includes("pausado")) return "#e2445c";
    if (normalized.includes("aguardando")) return "#a25ddc";
    if (normalized.includes("emailed")) return "#0086c0";

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
    if (error || !data?.session?.access_token) {
      throw new Error("Sessão expirada. Entre novamente.");
    }

    let res;
    try {
      res = await fetch(
        `${window.APP_CONFIG.SUPABASE_URL}/functions/v1/monday-responsaveis`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${data.session.access_token}`,
            apikey: window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY
          },
          body: JSON.stringify({ action, board_id: BOARD_ID, ...extra })
        }
      );
    } catch (error) {
      console.error("Falha de rede ao chamar monday-responsaveis", error);
      throw new Error("Não foi possível acessar a integração. Confira a publicação da Edge Function e a conexão.");
    }

    const raw = await res.text();
    let payload = null;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        console.error("Resposta não JSON da integração", { status: res.status, error });
      }
    }

    if (!res.ok || payload?.ok === false) {
      throw new Error(mensagemIntegracao(payload, res.status));
    }

    if (!payload || typeof payload !== "object") {
      throw new Error("A integração respondeu em um formato inválido. Publique novamente a Edge Function.");
    }

    return payload;
  }

  function userOptions(selectedId) {
    const base = ['<option value="">Sem responsável</option>'];
    state.sortedUsers.forEach(u => {
        const name = String(u.name || "").trim();
        const email = String(u.email || "").trim();
        const label = email && norm(name) !== norm(email) ? `${name} · ${email}` : (name || email);
        base.push(
          `<option value="${esc(u.id)}" ${String(selectedId) === String(u.id) ? "selected" : ""}>` +
          `${esc(label)}</option>`
        );
      });
    return base.join("");
  }

  function currentId(list) {
    return Array.isArray(list) && list.length ? String(list[0].id) : "";
  }

  function filtrar() {
    const q = norm($("gvBusca").value);
    const grupo = $("gvGrupo").value;
    return state.items.filter(x =>
      (!grupo || x.group_title === grupo) &&
      (!q || norm(`${x.name} ${x.group_title} ${x.gestor_text} ${x.revisor_text}`).includes(q))
    );
  }

  function render() {
    const rows = filtrar();
    $("gvExibidos").textContent = rows.length.toLocaleString("pt-BR");
    const count = $("gvBoardCount");
    if (count) count.textContent = `${rows.length.toLocaleString("pt-BR")} ${rows.length === 1 ? "item" : "itens"}`;
    const content = $("gvBoardContent");

    const grupos = new Map();
    rows.forEach(item => {
      const key = item.group_title || "Sem grupo";
      if (!grupos.has(key)) grupos.set(key, []);
      grupos.get(key).push(item);
    });

    const html = [];
    grupos.forEach((items, grupo) => {
      const color = groupColor(grupo);
      const collapsed = state.collapsedGroups.has(grupo);
      const limit = state.groupLimits.get(grupo) || GROUP_PAGE_SIZE;
      const visibleItems = items.slice(0, limit);
      const remaining = Math.max(0, items.length - visibleItems.length);

      html.push(`
        <section class="gv-monday-group" style="--group-color:${color}" data-group="${esc(grupo)}">
          <button class="gv-group-toggle" type="button" data-group="${esc(grupo)}" aria-expanded="${collapsed ? "false" : "true"}">
            <span class="gv-group-chevron ${collapsed ? "is-collapsed" : ""}">⌄</span>
            <span class="gv-group-title">${esc(grupo)}</span>
            <span class="gv-group-count">${items.length.toLocaleString("pt-BR")} ${items.length === 1 ? "item" : "itens"}</span>
          </button>
          <div class="gv-group-body ${collapsed ? "is-collapsed" : ""}">
            <div class="gv-group-table-scroll">
              <table class="gv-group-table">
                <thead>
                  <tr>
                    <th class="gv-col-item">Item</th>
                    <th>Gestor de Validação</th>
                    <th>Revisor Validador</th>
                    <th class="gv-col-action">Ação</th>
                  </tr>
                </thead>
                <tbody>`);

      visibleItems.forEach(item => {
        const gid = currentId(item.gestor_people);
        const rid = currentId(item.revisor_people);
        html.push(`
          <tr class="gv-data-row" data-id="${esc(item.id)}" data-g0="${esc(gid)}" data-r0="${esc(rid)}">
            <td class="gv-item-cell">
              <span class="gv-item-name">${esc(item.name)}</span>
              <span class="gv-current">ID ${esc(item.id)}</span>
            </td>
            <td>
              <select class="gv-row-select gv-gestor">${userOptions(gid)}</select>
              <span class="gv-current">Atual: ${esc(item.gestor_text || "Sem responsável")}</span>
            </td>
            <td>
              <select class="gv-row-select gv-revisor">${userOptions(rid)}</select>
              <span class="gv-current">Atual: ${esc(item.revisor_text || "Sem responsável")}</span>
            </td>
            <td><button type="button" class="gv-save" disabled>Salvar no Monday</button></td>
          </tr>`);
      });

      html.push(`
                </tbody>
              </table>
            </div>`);

      if (remaining > 0) {
        const next = Math.min(items.length, limit + GROUP_PAGE_SIZE);
        html.push(`
            <button class="gv-show-more" type="button" data-group="${esc(grupo)}" data-next="${next}">
              Mostrar mais ${Math.min(GROUP_PAGE_SIZE, remaining).toLocaleString("pt-BR")}
              <span>${visibleItems.length.toLocaleString("pt-BR")} de ${items.length.toLocaleString("pt-BR")}</span>
            </button>`);
      }

      html.push(`
          </div>
        </section>`);
    });

    content.innerHTML = html.join("") || '<div class="gv-empty">Nenhum item encontrado.</div>';
  }

  function renderGrupos() {
    const sel = $("gvGrupo");
    const atual = sel.value;
    const grupos = [...new Set(state.items.map(x => x.group_title).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    sel.innerHTML = '<option value="">Todos os grupos</option>' +
      grupos.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join("");
    if (grupos.includes(atual)) sel.value = atual;
  }

  async function carregar() {
    $("gvStatus").textContent = "Carregando...";
    $("gvBoard").textContent = "Carregando...";
    $("gvTotal").textContent = "0";
    $("gvExibidos").textContent = "0";
    const count = $("gvBoardCount");
    if (count) count.textContent = "0 itens";
    $("gvAtualizar").disabled = true;

    try {
      const p = await call("bootstrap");
      if (!p.board?.id || !Array.isArray(p.items) || !Array.isArray(p.users) || !p.columns?.gestor || !p.columns?.revisor) {
        throw new Error("A integração retornou dados incompletos. Publique novamente a Edge Function.");
      }
      state = {
        ...p,
        sortedUsers: p.users.slice().sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""), "pt-BR")),
        collapsedGroups: new Set(),
        groupLimits: new Map()
      };
      $("gvBoard").textContent = `${p.board.name} · ${p.board.id}`;
      $("gvTotal").textContent = p.items.length.toLocaleString("pt-BR");
      $("gvStatus").textContent = "Conectado";
      renderGrupos();
      render();
    } catch (e) {
      console.error(e);
      $("gvStatus").textContent = "Erro";
      $("gvBoard").textContent = "Não carregado";
      const message = e?.message || "Falha inesperada ao carregar os dados.";
      $("gvBoardContent").innerHTML = `<div class="gv-empty gv-empty-error">${esc(message)}</div>`;
      toast(message, true);
    } finally {
      $("gvAtualizar").disabled = false;
    }
  }

  function checkRow(tr) {
    const g = tr.querySelector(".gv-gestor").value;
    const r = tr.querySelector(".gv-revisor").value;
    const changed = g !== tr.dataset.g0 || r !== tr.dataset.r0;
    tr.classList.toggle("gv-changed", changed);
    tr.querySelector(".gv-save").disabled = !changed;
  }

  async function salvar(tr) {
    const btn = tr.querySelector(".gv-save");
    const itemId = tr.dataset.id;
    const gestor = tr.querySelector(".gv-gestor").value;
    const revisor = tr.querySelector(".gv-revisor").value;

    if (!confirm("Confirmar alteração dos responsáveis deste item diretamente no Monday?")) return;

    btn.disabled = true;
    btn.textContent = "Salvando...";

    try {
      const p = await call("update", {
        item_id: itemId,
        gestor_column_id: state.columns.gestor.id,
        revisor_column_id: state.columns.revisor.id,
        gestor_user_id: gestor,
        revisor_user_id: revisor
      });

      const cvs = Object.fromEntries((p.item?.column_values || []).map(c => [c.id, c]));
      const item = state.items.find(x => String(x.id) === String(itemId));

      if (item) {
        const gc = cvs[state.columns.gestor.id];
        const rc = cvs[state.columns.revisor.id];
        item.gestor_text = gc?.text || "";
        item.gestor_people = gc?.persons_and_teams || [];
        item.revisor_text = rc?.text || "";
        item.revisor_people = rc?.persons_and_teams || [];
      }

      toast("Responsáveis atualizados no Monday com sucesso.");
      render();
    } catch (e) {
      console.error(e);
      toast(e.message, true);
      btn.disabled = false;
      btn.textContent = "Salvar no Monday";
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const user = await window.protegerPagina();
    if (!user) return;

    const avatar = document.querySelector("[data-user-avatar]");
    if (avatar) {
      const nome = document.querySelector("[data-user-name]")?.textContent || user?.email || "U";
      const partes = String(nome).trim().split(/\s+/).filter(Boolean);
      avatar.textContent = ((partes[0]?.[0] || "U") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
    }

    $("gvBusca").addEventListener("input", () => {
      state.groupLimits = new Map();
      render();
    });
    $("gvGrupo").addEventListener("change", () => {
      state.groupLimits = new Map();
      render();
    });
    $("gvAtualizar").addEventListener("click", carregar);
    $("gvBoardContent").addEventListener("change", e => {
      if (e.target.matches(".gv-row-select")) checkRow(e.target.closest("tr"));
    });
    $("gvBoardContent").addEventListener("click", e => {
      const toggle = e.target.closest(".gv-group-toggle");
      if (toggle) {
        const grupo = toggle.dataset.group;
        if (state.collapsedGroups.has(grupo)) state.collapsedGroups.delete(grupo);
        else state.collapsedGroups.add(grupo);
        render();
        return;
      }

      const more = e.target.closest(".gv-show-more");
      if (more) {
        state.groupLimits.set(more.dataset.group, Number(more.dataset.next) || GROUP_PAGE_SIZE);
        render();
        return;
      }

      const b = e.target.closest(".gv-save");
      if (b) salvar(b.closest("tr"));
    });

    carregar();
  });
})();
