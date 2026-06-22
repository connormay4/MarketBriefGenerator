// Discover the 25-store set: Jack's Chick-fil-A + the 24 nearest OTHER CFAs.
//
// Uses Google Places API (New) Text Search with rankPreference=DISTANCE and a
// locationBias circle around the anchor store — the only Places method that
// reliably returns many same-brand locations ordered by distance (legacy text /
// nearby search return just the single closest brand match). Paginates to ~60,
// filters to real CFAs, and keeps the nearest 25.

const NEW_BASE = 'https://places.googleapis.com/v1';
const FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.businessStatus,nextPageToken';

function getApiKey() {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || key.startsWith('your_')) throw new Error('GOOGLE_PLACES_API_KEY is not configured.');
  return key;
}

function haversineMeters(a, b) {
  const R = 6_371_000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isCFA = name => /chick-?fil-?a/i.test(name || '');

async function searchText(body) {
  const res = await fetch(`${NEW_BASE}/places:searchText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': getApiKey(), 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Places (New): ${data.error.status} — ${data.error.message}`);
  return data;
}

function normalize(p, anchor) {
  const lat = p.location?.latitude, lng = p.location?.longitude;
  return {
    placeId: p.id,
    name: p.displayName?.text || 'Chick-fil-A',
    address: p.formattedAddress,
    lat, lng,
    rating: p.rating ?? null,
    reviewCount: p.userRatingCount ?? null,
    operational: p.businessStatus ? p.businessStatus === 'OPERATIONAL' : true,
    distanceM: anchor && lat != null ? haversineMeters(anchor, { lat, lng }) : 0,
  };
}

// Resolve Jack's store (the anchor) → {placeId, lat, lng, ...}.
async function resolveAnchor(location) {
  const storePlaceId = process.env.STORE_PLACE_ID;
  if (storePlaceId) {
    const res = await fetch(`${NEW_BASE}/places/${encodeURIComponent(storePlaceId)}`, {
      headers: { 'X-Goog-Api-Key': getApiKey(), 'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,rating,userRatingCount' },
    });
    const p = await res.json();
    if (!p.error && p.location) return normalize(p, null);
  }
  // Else: the nearest CFA to the configured address (relevance search).
  const data = await searchText({ textQuery: `Chick-fil-A ${location}`, pageSize: 1 });
  const first = (data.places || [])[0];
  if (!first) throw new Error('No Chick-fil-A found near ' + location);
  return normalize(first, null);
}

async function findNearbyCFAs({ location, max = 25 } = {}) {
  const anchor = await resolveAnchor(location);

  // Distance-ranked search around the anchor, paginated to ~60.
  const collected = [];
  let pageToken = null;
  for (let page = 0; page < 3 && collected.length < 60; page++) {
    const body = {
      textQuery: 'Chick-fil-A',
      rankPreference: 'DISTANCE',
      locationBias: { circle: { center: { latitude: anchor.lat, longitude: anchor.lng }, radius: 50000 } },
      pageSize: 20,
    };
    if (pageToken) body.pageToken = pageToken;
    const data = await searchText(body);
    collected.push(...(data.places || []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
    await sleep(1500);
  }

  const seen = new Set();
  let stores = collected
    .map(p => normalize(p, anchor))
    .filter(s => s.placeId && s.lat != null && isCFA(s.name) && s.operational)
    .filter(s => (seen.has(s.placeId) ? false : (seen.add(s.placeId), true)));

  // Ensure the anchor is present and flagged.
  if (!stores.some(s => s.placeId === anchor.placeId)) stores.unshift({ ...anchor, distanceM: 0 });
  stores = stores.map(s => ({ ...s, isSelf: s.placeId === anchor.placeId, distanceM: s.placeId === anchor.placeId ? 0 : s.distanceM }));
  stores.sort((a, b) => a.distanceM - b.distanceM);
  return stores.slice(0, max);
}

module.exports = { findNearbyCFAs, haversineMeters };
