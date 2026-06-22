const { generateJSON, MODELS } = require('./gemini');

// Classify each review into the four operator-relevant aspects, with sentiment
// per mentioned aspect. Batched (~20/call) to keep call-count — and rate-limit
// pressure — low. Default model is Gemini 2.5 Flash-Lite; set GEMINI_CLASSIFY_MODEL
// or wire OpenAI GPT-5 Nano for the cheapest path.

const ASPECTS = ['speed', 'accuracy', 'taste', 'courtesy'];
const ASPECT_SET = new Set(ASPECTS);

const RUBRIC = `Aspects (include ONLY those the review explicitly addresses):
- speed: speed of service, wait time, drive-thru/line/mobile-order speed
- accuracy: order correctness (right items, no missing/wrong items)
- taste: food taste, freshness, quality, temperature
- courtesy: team friendliness, politeness, helpfulness, attitude
Sentiment per aspect: 1 = positive, -1 = negative, 0 = neutral/mixed.`;

function buildPrompt(batch) {
  const items = batch.map((r, i) =>
    `[${i}] (${r.rating != null ? r.rating + '★' : 'no rating'}) ${(r.text || '').replace(/\s+/g, ' ').slice(0, 480)}`
  ).join('\n');
  return `You label restaurant reviews by aspect and sentiment.
${RUBRIC}

Reviews:
${items}

Return JSON exactly: {"results":[{"i":<index>,"aspects":[{"aspect":"speed","sentiment":1}]}]}.
One entry per review index. If a review mentions no listed aspect, return "aspects":[]. Do not invent aspects.`;
}

function sanitize(aspects) {
  if (!Array.isArray(aspects)) return [];
  const seen = new Set();
  const out = [];
  for (const a of aspects) {
    const aspect = String(a?.aspect || '').toLowerCase();
    let s = Number(a?.sentiment);
    if (!ASPECT_SET.has(aspect) || seen.has(aspect)) continue;
    if (![1, 0, -1].includes(s)) s = s > 0 ? 1 : s < 0 ? -1 : 0;
    seen.add(aspect);
    out.push({ aspect, sentiment: s });
  }
  return out;
}

async function classifyBatch(batch) {
  try {
    const data = await generateJSON(MODELS.classify, buildPrompt(batch), { thinkingBudget: 0 });
    const results = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
    const byIndex = new Map(results.map(r => [Number(r.i), sanitize(r.aspects)]));
    return batch.map((r, i) => ({ ...r, aspects: byIndex.get(i) || [] }));
  } catch (err) {
    console.warn('[classify] batch failed:', err.message);
    return batch.map(r => ({ ...r, aspects: [] }));
  }
}

// Run batches with limited concurrency to respect provider rate limits.
async function classifyReviews(reviews, { batchSize = 20, concurrency = 3 } = {}) {
  const batches = [];
  for (let i = 0; i < reviews.length; i += batchSize) batches.push(reviews.slice(i, i + batchSize));

  const results = [];
  for (let i = 0; i < batches.length; i += concurrency) {
    const slice = batches.slice(i, i + concurrency);
    const done = await Promise.all(slice.map(classifyBatch));
    for (const d of done) results.push(...d);
  }
  return results;
}

module.exports = { classifyReviews, classifyBatch, ASPECTS };
