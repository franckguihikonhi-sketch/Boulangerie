// Exécuté avant chaque fichier de test (voir vite.config.js -> test.setupFiles).
//
// db.js importe supabase.js, qui instancie un SupabaseClient au chargement du
// module. Le constructeur de @supabase/supabase-js initialise systématiquement
// un client realtime, qui exige un WebSocket natif — disponible dans tout
// navigateur, et dans Node.js à partir de la version 22, mais absent en
// Node 20 (utilisé par certains runners CI). Nos tests n'utilisent jamais
// réellement le canal realtime (aucun test n'appelle hydrate() en mode
// Supabase) : un stub minimal suffit à satisfaire cette vérification au
// démarrage, sans dépendance supplémentaire ni websocket fonctionnel.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class WebSocketStub {
    constructor() {}
    close() {}
    send() {}
    addEventListener() {}
    removeEventListener() {}
  };
}
