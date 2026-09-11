(function () {
  "use strict";

  const $ = id => document.getElementById(id);

  function dominioPermitido(email) {
    const dominio = String(email || "").toLowerCase().split("@").pop();
    return (window.APP_CONFIG.DOMINIOS_PERMITIDOS || []).includes(dominio);
  }

  function mensagem(texto, erro = false) {
    const el = $("loginMensagem");
    el.textContent = texto || "";
    el.className = erro ? "login-message error" : "login-message";
  }

  async function iniciar() {
    const params = new URLSearchParams(location.search);
    if (params.get("erro") === "dominio") {
      mensagem("Seu domínio de e-mail não está autorizado para este sistema.", true);
    }

    const { data } = await window.appSupabase.auth.getSession();
    if (data?.session && dominioPermitido(data.session.user?.email)) {
      location.replace("index.html");
      return;
    }

    $("loginForm").addEventListener("submit", async e => {
      e.preventDefault();
      mensagem("");

      const email = $("email").value.trim().toLowerCase();
      const password = $("password").value;
      const btn = $("entrarBtn");

      if (!dominioPermitido(email)) {
        mensagem("Use seu e-mail institucional autorizado.", true);
        return;
      }

      btn.disabled = true;
      btn.textContent = "Entrando...";

      try {
        const { data, error } = await window.appSupabase.auth.signInWithPassword({
          email,
          password
        });

        if (error) throw error;
        if (!data?.session) throw new Error("Não foi possível iniciar a sessão.");

        location.replace("index.html");
      } catch (err) {
        mensagem(err?.message || "Falha ao entrar.", true);
      } finally {
        btn.disabled = false;
        btn.textContent = "Entrar";
      }
    });

    $("resetSenha").addEventListener("click", async () => {
      const email = $("email").value.trim().toLowerCase();
      if (!email) {
        mensagem("Informe seu e-mail para receber a recuperação de senha.", true);
        return;
      }
      if (!dominioPermitido(email)) {
        mensagem("Use seu e-mail institucional autorizado.", true);
        return;
      }

      try {
        const redirectTo = new URL("login.html", location.href).href;
        const { error } = await window.appSupabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        mensagem("E-mail de recuperação enviado.");
      } catch (err) {
        mensagem(err?.message || "Não foi possível enviar a recuperação.", true);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
