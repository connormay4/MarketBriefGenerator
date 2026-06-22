const { fetchCompetitorData, fetchPlaceById } = require('./places');
const { generateJSON, MODELS } = require('./gemini');

// "A quick look at Google reviews of his location with a notable prompt."
// We pull Jack's own Chick-fil-A from Google Places (by STORE_PLACE_ID if set,
// else the nearest CFA to the configured location) and have the model surface a
// notable praise, a notable concern, and ONE concrete action prompt for the week.

async function getOwnStore(location) {
  const placeId = process.env.STORE_PLACE_ID;
  if (placeId && fetchPlaceById) {
    const byId = await fetchPlaceById(placeId).catch(() => null);
    if (byId && byId.rating != null) return byId;
  }
  // Nearest Chick-fil-A to the location = Jack's store.
  return fetchCompetitorData('Chick-fil-A', location);
}

async function summarizeReviews(store) {
  const reviews = (store.reviews || []).slice(0, 5).map((r, i) =>
    `[#${i + 1} | ${r.time || 'date n/a'} | ${r.rating}★ | ${r.author || 'Guest'}] ${(r.text || '').replace(/\s+/g, ' ').slice(0, 400)}`
  ).join('\n');

  const prompt = `You are coaching a Chick-fil-A operator on their OWN store's recent Google reviews (${store.rating}★, ${store.reviewCount} total).

Recent reviews:
${reviews || '(no review text available)'}

From ONLY these reviews, return JSON:
{
  "headline": "one-sentence read on the current review vibe",
  "notablePraise": { "quote": "a short verbatim or lightly-trimmed positive quote", "author": "name or 'Guest'", "when": "relative time", "rating": 5 },
  "notableConcern": { "quote": "a short quote from the most useful critical review, or null if none", "author": "...", "when": "...", "rating": 2 } ,
  "prompt": "ONE specific, encouraging action the operator can take THIS WEEK tied to these reviews (e.g., share a win at the team huddle, reply to a reviewer, check AM holding times). Be concrete."
}
Rules: do not invent reviews or facts not present above. Treat reviews as individual opinions, not established facts. If there is no genuine concern, set notableConcern to null.`;

  return generateJSON(MODELS.synthesis, prompt, { thinkingBudget: 128 });
}

async function buildOwnStoreHighlight({ location } = {}) {
  let store;
  try {
    store = await getOwnStore(location);
  } catch (err) {
    return { available: false, error: err.message };
  }
  if (!store || store.rating == null) {
    return { available: false, error: store?.error || 'Could not load your store from Google Places' };
  }

  let highlight = null;
  if (store.reviews?.length) {
    try { highlight = await summarizeReviews(store); }
    catch (err) { console.warn('[ownStore] summarize failed:', err.message); }
  }

  return {
    available: true,
    store: {
      name: store.name || 'Your Chick-fil-A',
      rating: store.rating,
      reviewCount: store.reviewCount,
      address: store.address || null,
      reviews: (store.reviews || []).slice(0, 5),
    },
    highlight,
  };
}

module.exports = { buildOwnStoreHighlight, getOwnStore };
