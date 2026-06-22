// Vercel serverless entry point.
//
// Vercel treats every file under /api as a serverless function. This one simply
// re-exports the existing Express app (server/index.js already does
// `module.exports = app`), so the WHOLE backend runs as a single catch-all
// function on Vercel — no Railway, no separate always-on host. vercel.json
// rewrites every /api/* request to this file; the Express routers inside handle
// the actual paths (/api/briefs, /api/settings, /api/cron/*, ...).
//
// Because require.main !== module here, server/index.js does NOT call
// app.listen() — Vercel invokes the exported handler per request instead.
module.exports = require('../server/index.js');
