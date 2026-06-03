const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const briefsRouter = require('./routes/briefs');
const settingsRouter = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/briefs', briefsRouter);
app.use('/api/settings', settingsRouter);

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ─── Serve the built React app (production) ──────────────────────────────────
// In production we serve the Vite build from this same Express server. That
// puts the frontend and the /api backend on the SAME origin, so the client's
// relative "/api" calls work from ANY computer hitting the deployed URL — not
// just the dev machine. (In local dev you run `npm run dev`, where Vite serves
// the client and proxies /api here, so this block is simply skipped.)
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  // SPA fallback: any non-API GET returns index.html so client routing works.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
  console.log(`[server] serving client build from ${CLIENT_DIST}`);
} else {
  console.log('[server] no client build found — API-only mode (run `npm run build` for production)');
}

// Bind to 0.0.0.0 so cloud hosts (Railway, etc.) can route external traffic.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
