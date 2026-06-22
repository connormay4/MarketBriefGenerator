const { runResearchPipeline } = require('./research');
const { getPrices } = require('./pricing');
const { buildOwnStoreHighlight } = require('./ownStore');
const { generateBreakfastIdeas } = require('./breakfast');
const { one } = require('../db');

// Read the most recent saved 25-CFA ranking, if one exists (Phase 2 produces
// these on the weekly run). Returns null when ranking hasn't run yet.
async function getLatestRanking() {
  try {
    const row = await one("SELECT payload FROM snapshots WHERE kind = 'ranking' ORDER BY created_at DESC LIMIT 1");
    return row ? JSON.parse(row.payload) : null;
  } catch {
    return null;
  }
}

// Assemble the FULL brief: the core research markdown + all structured sections.
// `emit(event, data)` streams progress (SSE route passes a real emitter; the
// cron passes a no-op). Each section is isolated so a single failure degrades
// gracefully to a missing section rather than a failed brief.
async function assembleBrief({
  competitors,
  location,
  sections,
  emit = () => {},
  includePricing = true,
  includeOwnStore = true,
  includeBreakfast = true,
} = {}) {
  // 1) Core research (ratings + news + recommendations markdown).
  const { brief: markdown, competitorData } = await runResearchPipeline({ competitors, location, sections, emit });

  // 2) Structured sections — gathered in parallel, each fault-isolated.
  emit('progress', { step: 'extras', status: 'running', message: 'Adding pricing, your reviews, and breakfast ideas...' });

  const tasks = {
    pricing: includePricing ? getPrices() : Promise.resolve(null),
    ownStore: includeOwnStore ? buildOwnStoreHighlight({ location }) : Promise.resolve(null),
    breakfast: includeBreakfast ? generateBreakfastIdeas({ location }) : Promise.resolve(null),
    rankings: getLatestRanking(),
  };

  const settled = await Promise.allSettled(Object.values(tasks));
  const keys = Object.keys(tasks);
  const extras = {};
  settled.forEach((r, i) => {
    const key = keys[i];
    if (r.status === 'fulfilled') {
      extras[key] = r.value;
    } else {
      console.warn(`[brief] extra "${key}" failed:`, r.reason?.message);
      extras[key] = { available: false, error: r.reason?.message };
    }
  });

  emit('progress', { step: 'extras', status: 'done', message: 'Brief assembled' });

  return { markdown, competitorData, extras };
}

module.exports = { assembleBrief, getLatestRanking };
