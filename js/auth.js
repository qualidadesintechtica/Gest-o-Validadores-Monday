(function () {
  "use strict";

  function dominioPermitido(email) {
    const dominio = String(email || "").toLowerCase().split("@").pop();
    return (window.APP_CONFIG.DOMINIOS_PERMITIDOS || []).includes(dominio);
  }

  async function protegerPagina() {
    const { data, error } = await window.appSupabase.auth.getSession();

    if (error || !data?.session) {
      window.location.replace("login.html");
      return null;
    }

    const user = data.session.user;

    if (!dominioPermitido(user.email)) {
      await window.appSupabase.auth.signOut();
      window.location.replace("login.html?erro=dominio");
      return null;
    }

    const nome =
      user.user_metadata?.nome ||
      user.user_metadata?.full_name ||
      user.email?.split("@")[0] ||
      "Usuário";

    document.querySelectorAll("[data-user-name]").forEach(el => {
      el.textContent = nome;
    });

    return user;
  }

  async function sair() {
    sessionStorage.removeItem("gv-audit-access-logged-v2");
    await window.appSupabase.auth.signOut();
    window.location.replace("login.html");
  }

  window.protegerPagina = protegerPagina;
  window.sairApp = sair;
})();
