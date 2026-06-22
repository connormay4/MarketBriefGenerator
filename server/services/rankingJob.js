const { all, one, run } = require('../db');
const { findNearbyCFAs } = require('./discovery');
const { fetchReviewsForPlace, usingOutscraper } = require('./reviews');
const { classifyReviews } = require('./classify');
const { computeRanking } = require('./ranking');

// Orchestrates the 25-CFA ranking: discover stores → fetch recent reviews →
// classify aspects → persist (deduped, incremental) → compute ranks → snapshot.
// Runs inline here; for very large Outscraper pulls the same processStore() can
// be driven chunk-by-chunk from the cron stepper (see routes/cron.js).

async function upsertLocations(stores) {
  for (const s of stores) {
    await run(
      `INSERT INTO cfa_locations (place_id, name, address, lat, lng, distance_m, is_self, rating, review_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(place_id) DO UPDATE SET
         name=excluded.name, address=excluded.address, lat=excluded.lat, lng=excluded.lng,
         distance_m=excluded.distance_m, is_self=excluded.is_self, rating=excluded.rating,
         review_count=excluded.review_count, updated_at=excluded.updated_at`,
      [s.placeId, s.name, s.address, s.lat, s.lng, s.distanceM, s.isSelf ? 1 : 0, s.rating, s.reviewCount]
    );
  }
}

async function persistReviews(reviews) {
  for (const r of reviews) {
    await run(
      `INSERT OR IGNORE INTO reviews (place_id, review_uid, author, rating, text, published_at, aspects, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.placeId, r.reviewUid, r.author, r.rating, r.text, r.publishedAt, JSON.stringify(r.aspects || []), r.source]
    );
  }
}

// Fetch + classify + persist reviews for one store. sinceUnix limits Outscraper
// to new reviews only (incremental weekly pulls).
async function processStore(store, { sinceUnix, limit = 60 } = {}) {
  const raw = await fetchReviewsForPlace(store.placeId, { limit, sinceUnix });
  if (!raw.length) return { placeId: store.placeId, fetched: 0, classified: 0 };
  const classified = await classifyReviews(raw);
  await persistReviews(classified);
  return { placeId: store.placeId, fetched: raw.length, classified: classified.length };
}

// Load stored reviews per place within the lookback window for aggregation.
async function loadReviewsByPlace(placeIds, days = 90) {
  const cutoffIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const map = new Map();
  for (const id of placeIds) {
    const rows = await all(
      'SELECT rating, text, published_at, aspects FROM reviews WHERE place_id = ? AND (published_at IS NULL OR published_at >= ?)',
      [id, cutoffIso]
    );
    map.set(id, rows.map(r => ({
      rating: r.rating,
      text: r.text,
      publishedAt: r.published_at,
      aspects: r.aspects ? JSON.parse(r.aspects) : [],
    })));
  }
  return map;
}

// Full inline refresh. onProgress(msg) optional. Returns the ranking snapshot.
async function refreshRanking({ location, onProgress = () => {}, storeConcurrency = 4, sinceUnix } = {}) {
  onProgress('Finding the 24 nearest Chick-fil-A locations…');
  const stores = await findNearbyCFAs({ location });
  await upsertLocations(stores);
  onProgress(`Found ${stores.length} stores. Pulling reviews…`);

  // Process stores with limited concurrency.
  let done = 0;
  for (let i = 0; i < stores.length; i += storeConcurrency) {
    const slice = stores.slice(i, i + storeConcurrency);
    await Promise.all(slice.map(s => processStore(s, { sinceUnix }).catch(err => {
      console.warn(`[ranking] store ${s.name} failed:`, err.message);
      return null;
    })));
    done += slice.length;
    onProgress(`Reviewed ${Math.min(done, stores.length)}/${stores.length} stores…`);
  }

  onProgress('Scoring and ranking…');
  const reviewsByPlace = await loadReviewsByPlace(stores.map(s => s.placeId));
  const source = usingOutscraper() ? 'outscraper' : 'places';
  const snapshot = computeRanking({ locations: stores, reviewsByPlace, source });

  await run("INSERT INTO snapshots (kind, payload) VALUES ('ranking', ?)", [JSON.stringify(snapshot)]);
  onProgress('Ranking complete.');
  return snapshot;
}

module.exports = { refreshRanking, processStore, upsertLocations, persistReviews, loadReviewsByPlace };
