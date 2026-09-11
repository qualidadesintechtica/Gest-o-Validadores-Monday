(function () {
  "use strict";

  if (!window.supabase?.createClient) {
    throw new Error("Supabase JS não foi carregado.");
  }

  window.appSupabase = window.supabase.createClient(
    window.APP_CONFIG.SUPABASE_URL,
    window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY
  );
})();
