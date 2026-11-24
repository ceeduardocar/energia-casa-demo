// Abre a conexão com o Supabase cedo. Fica em arquivo (e não inline no index.html) para a CSP não precisar de 'unsafe-inline'.
try { var u = (window.ENERGIA_CONFIG || {}).SUPABASE_URL; if (u) { var l = document.createElement("link"); l.rel = "preconnect"; l.href = u; l.crossOrigin = ""; document.head.appendChild(l); } } catch (e) {}
