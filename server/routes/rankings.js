const express = require('express');
const router = express.Router();
const { one } = require('../db');
const { refreshRanking } = require('../services/rankingJob');

// GET /api/rankings/latest — the most recent ranking snapshot (or null).
router.get('/latest', async (req, res) => {
  try {
    const row = await one("SELECT payload, created_at FROM snapshots WHERE kind = 'ranking' ORDER BY created_at DESC LIMIT 1");
    if (!row) return res.json(null);
    res.json({ ...JSON.parse(row.payload), updatedAt: row.created_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rankings/refresh — run the 25-CFA ranking now (SSE progress).
// Heavy-ish; streamed so the UI can show progress. Use ?location= to override.
router.post('/refresh', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const locationRow = await one("SELECT value FROM settings WHERE key = 'location'");
    const location = req.body?.location || locationRow?.value || process.env.LOCATION || 'Hanover, PA 17331';
    const snapshot = await refreshRanking({ location, onProgress: msg => emit('progress', { message: msg }) });
    emit('complete', snapshot);
  } catch (err) {
    console.error('[rankings] refresh failed:', err);
    emit('error', { message: err.message });
  } finally {
    res.end();
  }
});

module.exports = router;
