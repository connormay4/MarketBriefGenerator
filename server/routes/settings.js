const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// GET /api/settings
router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
  }

  const competitors = db.prepare('SELECT id, name, active FROM competitors ORDER BY name').all();
  res.json({ ...settings, competitors });
});

// PUT /api/settings
router.put('/', (req, res) => {
  const db = getDb();
  const { location, sections } = req.body;

  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

  if (location !== undefined) upsert.run('location', location);
  if (sections !== undefined) upsert.run('sections', JSON.stringify(sections));

  res.json({ ok: true });
});

// POST /api/settings/competitors — add a competitor
router.post('/competitors', (req, res) => {
  const db = getDb();
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    db.prepare('INSERT INTO competitors (name, active) VALUES (?, 1)').run(name.trim());
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: 'Competitor already exists' });
  }
});

// PUT /api/settings/competitors/:id — toggle active
router.put('/competitors/:id', (req, res) => {
  const db = getDb();
  const { active } = req.body;
  db.prepare('UPDATE competitors SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/settings/competitors/:id
router.delete('/competitors/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM competitors WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
