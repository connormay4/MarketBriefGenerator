const express = require('express');
const router = express.Router();
const { all, one, run } = require('../db');
const { assembleBrief } = require('../services/brief');
const { renderBriefEmail, sendBriefEmail, sendTestEmail } = require('../services/email');
const { refreshRanking } = require('../services/rankingJob');

// ─── Auth ─────────────────────────────────────────────────────────────────────
// Vercel Cron calls this endpoint with `Authorization: Bearer <CRON_SECRET>`.
// We accept that, or a ?key= for manual testing. If CRON_SECRET is unset we
// allow it (dev convenience) but warn.
function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[cron] CRON_SECRET not set — endpoint is UNPROTECTED');
    return true;
  }
  const header = req.headers.authorization || '';
  return header === `Bearer ${secret}` || req.query.key === secret;
}

// ─── ISO week run key (e.g. "2026-W25") to dedupe a given week ────────────────
function isoWeekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const STALE_RUN_MS = 30 * 60 * 1000;

// Claim the weekly run as a lock. Returns {ok:true} if we own it, or
// {ok:false, reason} if it's already done / actively in progress.
async function claimRun(runKey, force) {
  const existing = await one('SELECT * FROM job_runs WHERE run_key = ?', [runKey]);
  if (existing && !force) {
    if (existing.status === 'done') return { ok: false, reason: 'already-sent', run: existing };
    if (existing.status === 'running') {
      const ts = new Date((existing.updated_at || existing.created_at).replace(' ', 'T') + 'Z').getTime();
      if (Date.now() - ts < STALE_RUN_MS) return { ok: false, reason: 'in-progress', run: existing };
    }
  }
  try {
    if (existing) {
      await run("UPDATE job_runs SET status='running', updated_at=datetime('now') WHERE run_key=?", [runKey]);
    } else {
      await run("INSERT INTO job_runs (job, run_key, status, updated_at) VALUES ('weekly', ?, 'running', datetime('now'))", [runKey]);
    }
  } catch (err) {
    // UNIQUE race: another invocation claimed it first.
    return { ok: false, reason: 'race', error: err.message };
  }
  return { ok: true };
}

async function finishRun(runKey, status, result) {
  await run("UPDATE job_runs SET status=?, result=?, updated_at=datetime('now') WHERE run_key=?",
    [status, result ? JSON.stringify(result) : null, runKey]);
}

function dateLabel() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
  });
}

// ─── The weekly job ───────────────────────────────────────────────────────────
async function runWeekly({ force = false, send = true } = {}) {
  const runKey = isoWeekKey();
  const claim = await claimRun(runKey, force);
  if (!claim.ok) return { skipped: true, reason: claim.reason, runKey };

  try {
    const locationRow = await one("SELECT value FROM settings WHERE key = 'location'");
    const sectionsRow = await one("SELECT value FROM settings WHERE key = 'sections'");
    const location = locationRow?.value || process.env.LOCATION || 'Hanover, PA 17331';
    const sections = sectionsRow ? JSON.parse(sectionsRow.value) : ['ratings', 'news', 'recommendations'];
    const competitors = (await all("SELECT name FROM competitors WHERE active = 1")).map(r => r.name);

    // Refresh the 25-CFA ranking first so the brief picks up fresh ranks.
    // Fault-isolated: a ranking failure must not block the weekly email.
    try {
      await refreshRanking({ location });
    } catch (err) {
      console.warn('[cron] ranking refresh failed (continuing without it):', err.message);
    }

    const { markdown, competitorData, extras } = await assembleBrief({ competitors, location, sections });

    // Persist the brief.
    const ratingsSnapshot = JSON.stringify(competitorData.map(c => ({ name: c.name, rating: c.rating, reviewCount: c.reviewCount })));
    const ins = await run(
      'INSERT INTO briefs (location, content, ratings_snapshot, extras) VALUES (?, ?, ?, ?)',
      [location, markdown, ratingsSnapshot, JSON.stringify(extras)]
    );
    const briefId = Number(ins.lastInsertRowid);

    // Snapshot ratings for trend lines.
    await run("INSERT INTO snapshots (kind, payload) VALUES ('ratings', ?)", [ratingsSnapshot]);

    // Render + send the email.
    const html = await renderBriefEmail({ location, dateLabel: dateLabel(), markdown, ...extras });
    let emailResult = { sent: false, skipped: 'send=false' };
    if (send) {
      emailResult = await sendBriefEmail({ html, subject: `Your Weekly Market Brief — ${location.split(',')[0]}` });
    }

    const result = { briefId, runKey, email: emailResult };
    await finishRun(runKey, 'done', result);
    return { ok: true, ...result };
  } catch (err) {
    console.error('[cron] weekly failed:', err);
    await finishRun(runKey, 'error', { error: err.message });
    throw err;
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────
// Vercel Cron hits GET /api/cron/weekly. Manual: add ?force=1 and/or ?send=0.
router.get('/weekly', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const out = await runWeekly({ force: req.query.force === '1', send: req.query.send !== '0' });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.post('/weekly', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const out = await runWeekly({ force: req.query.force === '1', send: req.query.send !== '0' });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preview the rendered email HTML without sending (handy for design QA).
router.get('/preview', async (req, res) => {
  if (!authorized(req)) return res.status(401).send('unauthorized');
  try {
    const brief = await one('SELECT * FROM briefs ORDER BY created_at DESC LIMIT 1');
    if (!brief) return res.status(404).send('No brief yet — generate one first.');
    const extras = brief.extras ? JSON.parse(brief.extras) : {};
    const html = await renderBriefEmail({ location: brief.location, dateLabel: dateLabel(), markdown: brief.content, ...extras });
    res.set('Content-Type', 'text/html').send(html);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Build + email a FULL brief on demand (for previewing exactly what the weekly
// send produces). Uses the latest saved brief if one exists (fast), else
// generates a fresh one. Merges the freshest ranking snapshot. Streams progress
// via the passed emit(event, data). Does NOT take the weekly idempotency lock.
async function sendBriefEmailNow({ emit = () => {}, to } = {}) {
  emit('progress', { message: 'Preparing your brief…' });
  const locationRow = await one("SELECT value FROM settings WHERE key = 'location'");
  const location = locationRow?.value || process.env.LOCATION || 'Hanover, PA 17331';

  let brief = await one('SELECT location, content, extras FROM briefs ORDER BY created_at DESC LIMIT 1');
  let extras;
  if (!brief) {
    emit('progress', { message: 'No brief yet — generating a fresh one (~1–2 min)…' });
    const sectionsRow = await one("SELECT value FROM settings WHERE key = 'sections'");
    const sections = sectionsRow ? JSON.parse(sectionsRow.value) : ['ratings', 'news', 'recommendations'];
    const competitors = (await all("SELECT name FROM competitors WHERE active = 1")).map(r => r.name);
    const assembled = await assembleBrief({ competitors, location, sections, emit });
    const snap = JSON.stringify(assembled.competitorData.map(c => ({ name: c.name, rating: c.rating, reviewCount: c.reviewCount })));
    await run('INSERT INTO briefs (location, content, ratings_snapshot, extras) VALUES (?, ?, ?, ?)',
      [location, assembled.markdown, snap, JSON.stringify(assembled.extras)]);
    brief = { location, content: assembled.markdown };
    extras = assembled.extras;
  } else {
    extras = brief.extras ? JSON.parse(brief.extras) : {};
  }

  // Merge the freshest ranking snapshot so the rank board is current.
  const rankRow = await one("SELECT payload FROM snapshots WHERE kind = 'ranking' ORDER BY created_at DESC LIMIT 1");
  if (rankRow) { try { extras = { ...extras, rankings: JSON.parse(rankRow.payload) }; } catch {} }

  emit('progress', { message: 'Rendering and sending the email…' });
  const html = await renderBriefEmail({ location: brief.location || location, dateLabel: dateLabel(), markdown: brief.content, ...extras });
  const result = await sendBriefEmail({ html, subject: `Your Weekly Market Brief — ${(brief.location || location).split(',')[0]}`, to });
  return result;
}

// Send a tiny test email to confirm Resend key + sender + recipient all work,
// WITHOUT running the heavy brief pipeline. ?to= overrides the recipient.
async function testEmail(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    res.json(await sendTestEmail({ to: req.query.to }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
router.get('/test-email', testEmail);
router.post('/test-email', testEmail);

module.exports = router;
module.exports.runWeekly = runWeekly;
