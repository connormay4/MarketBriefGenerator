const express = require('express');
const router = express.Router();
const { all, one, run } = require('../db');
const { assembleBrief } = require('../services/brief');

// GET /api/briefs — list all past briefs
router.get('/', async (req, res) => {
  try {
    const briefs = await all(
      'SELECT id, created_at, location, ratings_snapshot FROM briefs ORDER BY created_at DESC'
    );
    res.json(briefs.map(b => ({
      ...b,
      ratings_snapshot: JSON.parse(b.ratings_snapshot)
    })));
  } catch (err) {
    console.error('[briefs] list failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/briefs/:id — get single brief
router.get('/:id', async (req, res) => {
  try {
    const brief = await one('SELECT * FROM briefs WHERE id = ?', [req.params.id]);
    if (!brief) return res.status(404).json({ error: 'Brief not found' });
    res.json({
      ...brief,
      ratings_snapshot: JSON.parse(brief.ratings_snapshot)
    });
  } catch (err) {
    console.error('[briefs] get failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/briefs/generate — SSE stream, runs full pipeline
router.post('/generate', async (req, res) => {
  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    // Load settings
    const locationRow = await one("SELECT value FROM settings WHERE key = 'location'");
    const sectionsRow = await one("SELECT value FROM settings WHERE key = 'sections'");
    const location = locationRow?.value || process.env.LOCATION || 'Atlanta, GA';
    const sections = sectionsRow ? JSON.parse(sectionsRow.value) : ['ratings', 'news', 'recommendations'];

    // Load active competitors
    const competitorRows = await all("SELECT name FROM competitors WHERE active = 1");
    const competitors = competitorRows.map(r => r.name);

    // Note: we intentionally do NOT load a previous brief for trend comparison.
    // Review trends are derived from the recency of the live Google reviews in
    // the pipeline, not from a prior saved brief.
    const { brief, competitorData } = await runResearchPipeline(res, {
      competitors,
      location,
      sections
    });

    // Save to DB
    const ratingsSnapshot = JSON.stringify(competitorData.map(c => ({
      name: c.name,
      rating: c.rating,
      reviewCount: c.reviewCount
    })));

    const result = await run(
      'INSERT INTO briefs (location, content, ratings_snapshot) VALUES (?, ?, ?)',
      [location, brief, ratingsSnapshot]
    );

    // libSQL returns lastInsertRowid as BigInt
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
router.delete('/:id', async (req, res) => {
  try {
    await run('DELETE FROM briefs WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[briefs] delete failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
