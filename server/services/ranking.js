const { ASPECTS } = require('./classify');

// Turn classified reviews for the 25-store set into honest ranks for Jack's
// store. Aspect categories rank by the WILSON lower bound of positive share
// (so a store with many consistent reviews beats one with a couple of lucky
// ones), and stores below a minimum-mentions threshold are marked "insufficient
// data" rather than guessed. Overall rating uses Google's star rating; "reviews
// this past month" is raw recent volume (context, not quality).

const Z = 1.96; // 95% confidence

function wilsonLowerBound(pos, n) {
  if (n === 0) return 0;
  const p = pos / n;
  const z2 = Z * Z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = Z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (center - margin) / denom;
}

function aspectStats(reviews, aspect) {
  let pos = 0, neg = 0;
  for (const r of reviews) {
    for (const a of r.aspects || []) {
      if (a.aspect !== aspect) continue;
      if (a.sentiment === 1) pos++;
      else if (a.sentiment === -1) neg++;
    }
  }
  return { pos, neg, n: pos + neg };
}

function monthCount(reviews) {
  const cutoff = Date.now() - 30 * 86_400_000;
  return reviews.filter(r => r.publishedAt && new Date(r.publishedAt).getTime() >= cutoff).length;
}

// Rank an array of {placeId, isSelf, score, n, hasData}. Higher score = rank 1.
// Returns { rank, rankedOf, selfN } for the self store.
function rankStores(entries) {
  const ranked = entries.filter(e => e.hasData).sort((a, b) => b.score - a.score || (b.n - a.n));
  const rankedOf = ranked.length;
  const idx = ranked.findIndex(e => e.isSelf);
  const self = entries.find(e => e.isSelf);
  return {
    rank: idx >= 0 ? idx + 1 : null,
    rankedOf,
    n: self ? self.n : null,
  };
}

const ASPECT_LABELS = {
  speed: 'Speed of service',
  accuracy: 'Order accuracy',
  taste: 'Food taste',
  courtesy: 'Courteous team',
};

function computeRanking({ locations, reviewsByPlace, minMentions = 8, minRatingCount = 25, source = 'places' } = {}) {
  const self = locations.find(l => l.isSelf);
  const reviewsFor = id => reviewsByPlace.get(id) || reviewsByPlace[id] || [];

  // Overall rating — Google star rating (already an aggregate).
  const overall = rankStores(locations.map(l => ({
    placeId: l.placeId, isSelf: !!l.isSelf,
    score: l.rating ?? 0,
    n: l.reviewCount ?? 0,
    hasData: l.rating != null && (l.reviewCount ?? 0) >= minRatingCount,
  })));

  // Reviews this past month — raw recent volume (context).
  const month = rankStores(locations.map(l => {
    const c = monthCount(reviewsFor(l.placeId));
    return { placeId: l.placeId, isSelf: !!l.isSelf, score: c, n: c, hasData: true };
  }));

  const categories = [
    { key: 'overall', label: 'Overall rating', ...overall },
    { key: 'month', label: 'Reviews this past month', ...month },
  ];

  // Aspect categories — Wilson lower bound on positive share, min-mentions gate.
  for (const aspect of ASPECTS) {
    const entries = locations.map(l => {
      const { pos, n } = aspectStats(reviewsFor(l.placeId), aspect);
      return {
        placeId: l.placeId, isSelf: !!l.isSelf,
        score: wilsonLowerBound(pos, n), n,
        hasData: n >= minMentions,
      };
    });
    categories.push({ key: aspect, label: ASPECT_LABELS[aspect], ...rankStores(entries) });
  }

  const usingFallback = source !== 'outscraper';
  const note = usingFallback
    ? 'Based on a small sample of public Google reviews (5/store) — directional only. Connect a reviews source for fuller, more confident ranks.'
    : 'Inferred from public Google reviews over the last 90 days — directional, not audited.';

  return {
    totalStores: locations.length,
    self: self ? { placeId: self.placeId, name: self.name } : null,
    source,
    note,
    generatedAt: new Date().toISOString(),
    categories,
  };
}

module.exports = { computeRanking, wilsonLowerBound, aspectStats, monthCount };
