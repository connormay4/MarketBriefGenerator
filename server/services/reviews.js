const { fetchPlaceById } = require('./places');

// Pull recent dated reviews for a place. Primary source is Outscraper (many
// reviews, real timestamps, `cutoff` for incremental weekly pulls). When no
// OUTSCRAPER_API_KEY is set we fall back to Google Places (max 5 reviews/place)
// so the feature still runs — clearly lower-confidence, flagged via `source`.

const OUTSCRAPER_BASE = 'https://api.outscraper.com/maps/reviews-v3';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Rough relative-time → ISO date (for the Places fallback, which gives only
// "a week ago"-style strings). Approximate; good enough to bucket "past month".
function relativeToIso(rel) {
  if (!rel) return null;
  const now = Date.now();
  const m = rel.match(/(\d+)\s+(day|week|month|year|hour|minute)s?\s+ago/i);
  if (/a day ago|yesterday/i.test(rel)) return new Date(now - 86400000).toISOString();
  if (/an? hour ago|minutes? ago|a minute ago/i.test(rel)) return new Date(now - 3600000).toISOString();
  if (/a week ago/i.test(rel)) return new Date(now - 7 * 86400000).toISOString();
  if (/a month ago/i.test(rel)) return new Date(now - 30 * 86400000).toISOString();
  if (/a year ago/i.test(rel)) return new Date(now - 365 * 86400000).toISOString();
  if (m) {
    const n = +m[1];
    const unit = { hour: 3600000, minute: 60000, day: 86400000, week: 7 * 86400000, month: 30 * 86400000, year: 365 * 86400000 }[m[2].toLowerCase()];
    return new Date(now - n * unit).toISOString();
  }
  return null;
}

function normOutscraper(r, placeId) {
  const ts = r.review_timestamp ? new Date(r.review_timestamp * 1000).toISOString()
    : r.review_datetime_utc ? new Date(r.review_datetime_utc).toISOString() : null;
  return {
    placeId,
    reviewUid: r.review_id || r.review_link || `${r.author_title}-${r.review_timestamp}`,
    author: r.author_title || 'Guest',
    rating: r.review_rating ?? r.rating ?? null,
    text: r.review_text || '',
    publishedAt: ts,
    source: 'outscraper',
  };
}

function extractOutscraperReviews(data, placeId) {
  // reviews-v3 returns data: [ [reviews...] ] (one inner array per query)
  const block = Array.isArray(data?.data) ? data.data[0] : (Array.isArray(data) ? data[0] : null);
  const reviews = Array.isArray(block) ? block : (block?.reviews_data || []);
  return reviews.map(r => normOutscraper(r, placeId)).filter(r => r.text);
}

async function pollOutscraper(location, key, { tries = 25, intervalMs = 3000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(location, { headers: { 'X-API-KEY': key } });
    const data = await res.json();
    const status = data.status;
    if (status === 'Success' || status === 'Completed') return data;
    if (status === 'Error' || status === 'Failed') throw new Error('Outscraper job failed');
    await sleep(intervalMs);
  }
  throw new Error('Outscraper job timed out');
}

async function outscraperReviews(placeId, { limit = 60, sinceUnix } = {}) {
  const key = process.env.OUTSCRAPER_API_KEY;
  const params = new URLSearchParams({
    query: placeId,
    reviewsLimit: String(limit),
    sort: 'newest',
    async: 'true',
  });
  if (sinceUnix) params.set('cutoff', String(sinceUnix));
  const res = await fetch(`${OUTSCRAPER_BASE}?${params.toString()}`, { headers: { 'X-API-KEY': key } });
  if (!res.ok) throw new Error(`Outscraper HTTP ${res.status}`);
  const data = await res.json();
  // Async submit returns a results_location to poll; sync returns data inline.
  if (data.results_location) {
    const done = await pollOutscraper(data.results_location, key);
    return extractOutscraperReviews(done, placeId);
  }
  return extractOutscraperReviews(data, placeId);
}

async function placesFallbackReviews(placeId) {
  const place = await fetchPlaceById(placeId);
  return (place.reviews || []).map((r, i) => ({
    placeId,
    reviewUid: `places-${placeId}-${i}-${(r.text || '').slice(0, 16)}`,
    author: r.author || 'Guest',
    rating: r.rating ?? null,
    text: r.text || '',
    publishedAt: relativeToIso(r.time),
    source: 'places',
  })).filter(r => r.text);
}

// Public: fetch recent reviews for one place. Uses Outscraper if keyed, else
// Places fallback. `sinceUnix` limits to reviews newer than that (Outscraper).
async function fetchReviewsForPlace(placeId, { limit = 60, sinceUnix } = {}) {
  const key = process.env.OUTSCRAPER_API_KEY;
  if (key && !key.startsWith('your_')) {
    return outscraperReviews(placeId, { limit, sinceUnix });
  }
  return placesFallbackReviews(placeId);
}

function usingOutscraper() {
  const key = process.env.OUTSCRAPER_API_KEY;
  return !!(key && !key.startsWith('your_'));
}

module.exports = { fetchReviewsForPlace, usingOutscraper, relativeToIso };
