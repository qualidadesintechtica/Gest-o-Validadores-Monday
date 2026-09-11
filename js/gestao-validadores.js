(function () {
  "use strict";

  const BOARD_ID = Number(window.APP_CONFIG.BOARD_ID);
  let state = { items: [], users: [], columns: null, board: null };

  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
  const norm = v => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  function toast(msg, error = false) {
    const el = $("gvToast");
    el.textContent = msg;
    el.className = "gv-toast" + (error ? " error" : "");
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 5000);
  }

  async function call(action, extra = {}) {
    const { data, error } = await window.appSupabase.auth.getSession();
    if (error || !data?.session?.access_token) {
      throw new Error("Sessão expirada. Entre novamente.");
    }

    const res = await fetch(
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

    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Falha HTTP ${res.status}`);
    }
    return payload;
  }

  function userOptions(selectedId) {
    const base = ['<option value="">Sem responsável</option>'];
    state.users
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .forEach(u => {
        base.push(
          `<option value="${esc(u.id)}" ${String(selectedId) === String(u.id) ? "selected" : ""}>` +
          `${esc(u.name)}${u.email ? ` · ${esc(u.email)}` : ""}</option>`
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
    const tbody = $("gvTbody");

    tbody.innerHTML = rows.slice(0, 300).map(item => {
      const gid = currentId(item.gestor_people);
      const rid = currentId(item.revisor_people);
      return `
        <tr data-id="${esc(item.id)}" data-g0="${esc(gid)}" data-r0="${esc(rid)}">
          <td>${esc(item.group_title)}</td>
          <td>
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
        </tr>`;
    }).join("") || '<tr><td colspan="5">Nenhum item encontrado.</td></tr>';

    if (rows.length > 300) {
      tbody.insertAdjacentHTML(
        "beforeend",
        `<tr><td colspan="5">Mostrando os primeiros 300 de ${rows.length.toLocaleString("pt-BR")} itens. Refine a busca.</td></tr>`
      );
    }
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
    $("gvAtualizar").disabled = true;

    try {
      const p = await call("bootstrap");
      state = p;
      $("gvBoard").textContent = `${p.board.name} · ${p.board.id}`;
      $("gvTotal").textContent = p.items.length.toLocaleString("pt-BR");
      $("gvStatus").textContent = "Conectado";
      renderGrupos();
      render();
    } catch (e) {
      console.error(e);
      $("gvStatus").textContent = "Erro";
      $("gvTbody").innerHTML = `<tr><td colspan="5">${esc(e.message)}</td></tr>`;
      toast(e.message, true);
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

    $("gvBusca").addEventListener("input", render);
    $("gvGrupo").addEventListener("change", render);
    $("gvAtualizar").addEventListener("click", carregar);
    $("gvTbody").addEventListener("change", e => {
      if (e.target.matches(".gv-row-select")) checkRow(e.target.closest("tr"));
    });
    $("gvTbody").addEventListener("click", e => {
      const b = e.target.closest(".gv-save");
      if (b) salvar(b.closest("tr"));
    });

    carregar();
  });
})();
