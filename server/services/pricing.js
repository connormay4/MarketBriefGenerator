const { all, one, run } = require('../db');
const { getClient, withRetry, parseJSON, MODELS } = require('./gemini');

// ─── Competitor signature items ───────────────────────────────────────────────
// Jack wants each competitor's chicken-sandwich price, OR their #1 meal if they
// don't sell a signature chicken sandwich. These are the DEFAULT item labels the
// operator can edit per competitor. Taco Bell has no signature chicken sandwich
// → its #1 combo. Prices are intentionally NOT seeded — the operator enters them
// (they know the real local Hanover prices), so the brief never invents a price.
const DEFAULT_ITEMS = {
  "McDonald's": 'McCrispy (chicken sandwich)',
  'Popeyes': 'Classic Chicken Sandwich',
  "Wendy's": "Crispy Chicken Sandwich",
  'Slim Chickens': 'Chicken Sandwich',
  'Taco Bell': '#1 Combo (no signature chicken sandwich)',
};

// A price is "stale" if it hasn't been verified in this many days.
const STALE_AFTER_DAYS = 30;

function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  const then = new Date(isoDate + (isoDate.length === 10 ? 'T00:00:00Z' : ''));
  if (isNaN(then.getTime())) return Infinity;
  return Math.floor((Date.now() - then.getTime()) / 86_400_000);
}

function formatPrice(cents) {
  if (cents == null) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

// Return one row per ACTIVE competitor, joined to any saved price. Competitors
// with no saved price still appear (price null) so the UI prompts the operator.
async function getPrices() {
  const competitors = await all('SELECT name FROM competitors WHERE active = 1 ORDER BY name');
  const priceRows = await all('SELECT * FROM competitor_prices');
  const byName = Object.fromEntries(priceRows.map(p => [p.competitor, p]));

  return competitors.map(({ name }) => {
    const p = byName[name];
    const age = daysSince(p?.last_verified);
    return {
      competitor: name,
      itemLabel: p?.item_label || DEFAULT_ITEMS[name] || 'Top meal',
      priceCents: p?.price_cents ?? null,
      priceDisplay: formatPrice(p?.price_cents),
      source: p?.source || 'unset',                 // operator | delivery | llm | unset
      confidence: p?.confidence || (p?.price_cents != null ? 'medium' : 'none'),
      lastVerified: p?.last_verified || null,
      stale: p?.price_cents != null && age > STALE_AFTER_DAYS,
      ageDays: isFinite(age) ? age : null,
      notes: p?.notes || null,
    };
  });
}

// Upsert an operator-entered (or refresh-sourced) price. Accepts dollars or
// cents; normalizes to cents. Defaults source/confidence for operator entry.
async function upsertPrice({ competitor, itemLabel, price, priceCents, source = 'operator', confidence = 'high', lastVerified, notes }) {
  if (!competitor) throw new Error('competitor is required');
  let cents = priceCents;
  if (cents == null && price != null && price !== '') {
    cents = Math.round(parseFloat(String(price).replace(/[^0-9.]/g, '')) * 100);
    if (isNaN(cents)) cents = null;
  }
  const verified = lastVerified || new Date().toISOString().slice(0, 10);
  await run(
    `INSERT INTO competitor_prices (competitor, item_label, price_cents, source, confidence, last_verified, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(competitor) DO UPDATE SET
       item_label    = excluded.item_label,
       price_cents   = excluded.price_cents,
       source        = excluded.source,
       confidence    = excluded.confidence,
       last_verified = excluded.last_verified,
       notes         = excluded.notes`,
    [competitor, itemLabel || DEFAULT_ITEMS[competitor] || 'Top meal', cents, source, confidence, verified, notes || null]
  );
  return getPrice(competitor);
}

async function getPrice(competitor) {
  const p = await one('SELECT * FROM competitor_prices WHERE competitor = ?', [competitor]);
  return p || null;
}

module.exports = { getPrices, upsertPrice, getPrice, formatPrice, DEFAULT_ITEMS, STALE_AFTER_DAYS };
