const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { runResearchPipeline } = require('../services/research');

// GET /api/briefs — list all past briefs
router.get('/', (req, res) => {
  const db = getDb();
  const briefs = db.prepare(
    'SELECT id, created_at, location, ratings_snapshot FROM briefs ORDER BY created_at DESC'
  ).all();

  res.json(briefs.map(b => ({
    ...b,
    ratings_snapshot: JSON.parse(b.ratings_snapshot)
  })));
});

// GET /api/briefs/:id — get single brief
router.get('/:id', (req, res) => {
  const db = getDb();
  const brief = db.prepare('SELECT * FROM briefs WHERE id = ?').get(req.params.id);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });

  res.json({
    ...brief,
    ratings_snapshot: JSON.parse(brief.ratings_snapshot)
  });
});

// POST /api/briefs/generate — SSE stream, runs full pipeline
router.post('/generate', async (req, res) => {
  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const db = getDb();

  try {
    // Load settings
    const locationRow = db.prepare("SELECT value FROM settings WHERE key = 'location'").get();
    const sectionsRow = db.prepare("SELECT value FROM settings WHERE key = 'sections'").get();
    const location = locationRow?.value || process.env.LOCATION || 'Atlanta, GA';
    const sections = sectionsRow ? JSON.parse(sectionsRow.value) : ['ratings', 'news', 'recommendations'];

    // Load active competitors
    const competitors = db.prepare("SELECT name FROM competitors WHERE active = 1").all().map(r => r.name);

    // Load last snapshot for trend comparison
    const lastBrief = db.prepare("SELECT ratings_snapshot FROM briefs ORDER BY created_at DESC LIMIT 1").get();
    const previousSnapshots = {};
    if (lastBrief) {
      const snapshot = JSON.parse(lastBrief.ratings_snapshot);
      for (const item of snapshot) {
        previousSnapshots[item.name] = item;
      }
    }

    const { brief, competitorData } = await runResearchPipeline(res, {
      competitors,
      location,
      sections,
      previousSnapshots
    });

    // Save to DB
    const ratingsSnapshot = JSON.stringify(competitorData.map(c => ({
      name: c.name,
      rating: c.rating,
      reviewCount: c.reviewCount
    })));

    const result = db.prepare(
      'INSERT INTO briefs (location, content, ratings_snapshot) VALUES (?, ?, ?)'
    ).run(location, brief, ratingsSnapshot);

    // node:sqlite returns BigInt for lastInsertRowid
    const newId = Number(result.lastInsertRowid);
    res.write(`event: complete\ndata: ${JSON.stringify({ id: newId, brief })}\n\n`);
  } catch (err) {
    console.error('Pipeline error:', err);
    res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

// DELETE /api/briefs/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM briefs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
