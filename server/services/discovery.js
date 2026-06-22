// Discover the 25-store set: Jack's Chick-fil-A + the 24 nearest OTHER CFAs.
//
// Uses Google Places Text Search to gather candidates, then ranks by true
// haversine distance from the anchor store and takes the nearest 25. We use the
// legacy text-search endpoint because it's enabled on the current key and
// returns geometry + pagination today; this module is the single place to swap
// to Places API (New) Text Search (rankPreference=DISTANCE) when that SKU is
// enabled — the rest of the pipeline is unaffected.

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';

function getApiKey() {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || key.startsWith('your_')) {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured.');
  }
  return key;
}

function haversineMeters(a, b) {
  const R = 6_371_000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Paginate legacy text search up to ~60 results (3 pages of 20).
async function textSearchAll(query, maxResults = 60) {
  const key = getApiKey();
  const out = [];
  let pageToken = null;
  for (let page = 0; page < 3 && out.length < maxResults; page++) {
    let url = `${PLACES_BASE}/textsearch/json?query=${encodeURIComponent(query)}&key=${key}`;
    if (pageToken) url += `&pagetoken=${pageToken}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Places text search HTTP ${res.status}`);
    const data = await res.json();
    if (data.status === 'REQUEST_DENIED' || data.status === 'INVALID_REQUEST') {
      throw new Error(`Places error: ${data.status}${data.error_message ? ' — ' + data.error_message : ''}`);
    }
    out.push(...(data.results || []));
    pageToken = data.next_page_token;
    if (!pageToken) break;
    // next_page_token needs a moment before it becomes valid.
    await sleep(2100);
  }
  return out.slice(0, maxResults);
}

async function fetchAnchorById(placeId) {
  const key = getApiKey();
  const url = `${PLACES_BASE}/details/json?place_id=${encodeURIComponent(placeId)}&fields=name,formatted_address,geometry,rating,user_ratings_total&key=${key}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') throw new Error(`Anchor details: ${data.status}`);
  const r = data.result;
  return {
    placeId,
    name: r.name,
    address: r.formatted_address,
    lat: r.geometry?.location?.lat,
    lng: r.geometry?.location?.lng,
    rating: r.rating ?? null,
    reviewCount: r.user_ratings_total ?? null,
  };
}

function normalize(r) {
  return {
    placeId: r.place_id,
    name: r.name,
    address: r.formatted_address,
    lat: r.geometry?.location?.lat,
    lng: r.geometry?.location?.lng,
    rating: r.rating ?? null,
    reviewCount: r.user_ratings_total ?? null,
    operational: r.business_status ? r.business_status === 'OPERATIONAL' : true,
  };
}

const isCFA = name => /chick-?fil-?a/i.test(name || '');

// Returns the nearest `max` CFAs (incl. self), sorted by distance, each with
// isSelf flag and distanceM. self is whichever is STORE_PLACE_ID, else nearest.
async function findNearbyCFAs({ location, max = 25 } = {}) {
  const raw = await textSearchAll(`Chick-fil-A near ${location}`, 60);
  const seen = new Set();
  let candidates = raw
    .map(normalize)
    .filter(c => c.placeId && c.lat != null && isCFA(c.name) && c.operational)
    .filter(c => (seen.has(c.placeId) ? false : (seen.add(c.placeId), true)));

  // Anchor (Jack's store): STORE_PLACE_ID if set, else the first/nearest result.
  let anchor;
  const storePlaceId = process.env.STORE_PLACE_ID;
  if (storePlaceId) {
    anchor = candidates.find(c => c.placeId === storePlaceId) || (await fetchAnchorById(storePlaceId).catch(() => null));
  }
  if (!anchor) anchor = candidates[0];
  if (!anchor) throw new Error('No Chick-fil-A locations found near ' + location);

  // Ensure the anchor is in the candidate set.
  if (!candidates.some(c => c.placeId === anchor.placeId)) candidates.unshift(anchor);

  const withDist = candidates.map(c => ({
    ...c,
    isSelf: c.placeId === anchor.placeId,
    distanceM: c.placeId === anchor.placeId ? 0 : haversineMeters(anchor, c),
  }));
  withDist.sort((a, b) => a.distanceM - b.distanceM);
  return withDist.slice(0, max);
}

module.exports = { findNearbyCFAs, haversineMeters };
