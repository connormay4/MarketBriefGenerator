const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';

function getApiKey() {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || key.startsWith('your_')) {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured. Add a valid key to your .env file.');
  }
  return key;
}

async function searchPlace(name, location) {
  const API_KEY = getApiKey();
  const query = encodeURIComponent(`${name} near ${location}`);
  const url = `${PLACES_BASE}/textsearch/json?query=${query}&key=${API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Places text search HTTP ${res.status}`);
  const data = await res.json();

  if (data.status === 'REQUEST_DENIED' || data.status === 'INVALID_REQUEST') {
    throw new Error(`Google Places API error: ${data.status}${data.error_message ? ' — ' + data.error_message : ''}`);
  }
  if (data.status === 'ZERO_RESULTS' || !data.results?.length) return null;

  const place = data.results[0];
  console.log(`[places] ${name} → "${place.name}" rating=${place.rating ?? 'N/A'} (${place.user_ratings_total ?? 0} reviews)`);
  return place;
}

async function getPlaceReviews(placeId) {
  const API_KEY = getApiKey();
  const url = `${PLACES_BASE}/details/json?place_id=${placeId}&fields=reviews&key=${API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Places details HTTP ${res.status}`);
  const data = await res.json();

  if (data.status !== 'OK') {
    throw new Error(`Places details: ${data.status}${data.error_message ? ' — ' + data.error_message : ''}`);
  }
  return data.result?.reviews || [];
}

async function fetchCompetitorData(name, location) {
  try {
    const place = await searchPlace(name, location);
    if (!place) {
      return { name, error: 'No location found nearby', rating: null, reviewCount: null, reviews: [] };
    }

    // rating + reviewCount come from the text search result directly — no Details call needed.
    const rating = place.rating ?? null;
    const reviewCount = place.user_ratings_total ?? null;

    // Reviews are a bonus; isolate so a missing scope doesn't kill the rating data.
    let reviews = [];
    try {
      const raw = await getPlaceReviews(place.place_id);
      reviews = raw.slice(0, 5).map(r => ({
        text: r.text,
        rating: r.rating,
        time: r.relative_time_description,
        author: r.author_name
      }));
    } catch (err) {
      console.warn(`[places] ${name} reviews unavailable: ${err.message}`);
    }

    return { name, placeId: place.place_id, address: place.formatted_address, rating, reviewCount, reviews };

  } catch (err) {
    // Propagate the real error message so the pipeline can surface it to the user
    console.error(`[places] ${name} failed: ${err.message}`);
    return { name, error: err.message, rating: null, reviewCount: null, reviews: [] };
  }
}

module.exports = { fetchCompetitorData };
