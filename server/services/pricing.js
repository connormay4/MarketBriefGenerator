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

// ─── AI price research (Gemini + Google Search grounding) ─────────────────────
// Local fast-food prices vary by store and aren't in any clean API, so we use a
// web-grounded model and return an explicit confidence (high/medium/low). It
// NEVER fabricates a precise number — unknown ⇒ null price, low confidence.
async function researchPrice({ competitor, itemLabel, location }) {
  const prompt = `Use Google Search to find the CURRENT dine-in price (US dollars) of "${itemLabel}" at ${competitor} near ${location}.
Respond with ONLY a JSON object and no other text:
{"priceUsd": <number or null>, "confidence": "high" | "medium" | "low", "note": "<short reason/source>"}
Confidence guide:
- "high": a specific, recent price for this item at a ${competitor} in or very near ${location} (official site/app for that store, or a current local menu).
- "medium": a regional or slightly dated price, or a close proxy item.
- "low": only a rough national estimate, or you are unsure.
Never fabricate a precise number. If you cannot find a credible price, set priceUsd to null and confidence to "low".`;

  const res = await withRetry(() => getClient().models.generateContent({
    model: MODELS.grounding,
    contents: prompt,
    config: { tools: [{ googleSearch: {} }], thinkingConfig: { thinkingBudget: 0 } },
  }), `price:${competitor}`);

  const data = parseJSON(res.text ?? '');
  const confidence = ['high', 'medium', 'low'].includes(data.confidence) ? data.confidence : 'low';
  const priceCents = (typeof data.priceUsd === 'number' && isFinite(data.priceUsd) && data.priceUsd > 0)
    ? Math.round(data.priceUsd * 100) : null;
  return { priceCents, confidence, note: data.note || null };
}

// Research every active competitor's price. Skips operator-verified prices by
// default (operator entry is the source of truth). Returns the refreshed list.
async function researchAllPrices({ location, overwriteOperator = false } = {}) {
  if (!location) {
    const row = await one("SELECT value FROM settings WHERE key = 'location'");
    location = row?.value || process.env.LOCATION || 'Hanover, PA 17331';
  }
  const current = await getPrices();
  for (const p of current) {
    if (!overwriteOperator && p.source === 'operator') continue;
    try {
      const r = await researchPrice({ competitor: p.competitor, itemLabel: p.itemLabel, location });
      await upsertPrice({
        competitor: p.competitor, itemLabel: p.itemLabel,
        priceCents: r.priceCents, source: 'llm', confidence: r.confidence,
        notes: r.note || (r.priceCents == null ? 'No reliable local price found' : null),
      });
    } catch (err) {
      console.warn(`[pricing] research failed for ${p.competitor}:`, err.message);
    }
  }
  return getPrices();
}

module.exports = { getPrices, upsertPrice, getPrice, researchPrice, researchAllPrices, formatPrice, DEFAULT_ITEMS, STALE_AFTER_DAYS };
