const express = require('express');
const router = express.Router();
const { all, run } = require('../db');
const { getPrices, upsertPrice, researchAllPrices } = require('../services/pricing');
const { sendTestEmail } = require('../services/email');

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const rows = await all('SELECT key, value FROM settings');
    const settings = {};
    for (const row of rows) {
      try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
    }

    const competitors = await all('SELECT id, name, active FROM competitors ORDER BY name');
    res.json({ ...settings, competitors });
  } catch (err) {
    console.error('[settings] get failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings
router.put('/', async (req, res) => {
  try {
    const { location, sections } = req.body;
    const upsert = 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)';

    if (location !== undefined) await run(upsert, ['location', location]);
    if (sections !== undefined) await run(upsert, ['sections', JSON.stringify(sections)]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[settings] update failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/competitors — add a competitor
router.post('/competitors', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    await run('INSERT INTO competitors (name, active) VALUES (?, 1)', [name.trim()]);
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: 'Competitor already exists' });
  }
});

// PUT /api/settings/competitors/:id — toggle active
router.put('/competitors/:id', async (req, res) => {
  try {
    const { active } = req.body;
    await run('UPDATE competitors SET active = ? WHERE id = ?', [active ? 1 : 0, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[settings] toggle failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/internal-data — operator-uploaded CFA internal (CEM) ranks
router.get('/internal-data', async (req, res) => {
  try {
    const row = await all("SELECT value FROM settings WHERE key = 'internal_metrics'");
    res.json(row[0] ? JSON.parse(row[0].value) : []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/internal-data — body: [{category,rank,of,percentile,note}]
// These become the authoritative "measured" ranks for Jack's store, overriding
// the inferred public-review ranks for matching categories on the next refresh.
router.put('/internal-data', async (req, res) => {
  try {
    const metrics = Array.isArray(req.body) ? req.body : (req.body?.metrics || []);
    await run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['internal_metrics', JSON.stringify(metrics)]);
    res.json({ ok: true, count: metrics.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/settings/prices — operator-seeded competitor prices
router.get('/prices', async (req, res) => {
  try {
    res.json(await getPrices());
  } catch (err) {
    console.error('[settings] prices get failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/prices — upsert one price (operator entry)
router.put('/prices', async (req, res) => {
  try {
    const saved = await upsertPrice(req.body || {});
    res.json({ ok: true, saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/settings/competitors/:id
router.delete('/competitors/:id', async (req, res) => {
  try {
    await run('DELETE FROM competitors WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[settings] delete failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
