const { GoogleGenAI } = require('@google/genai');
const { fetchCompetitorData } = require('./places');

function getApiKey() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key || key.startsWith('your_')) {
    throw new Error('GEMINI_API_KEY is not configured. Add a valid Google AI Studio key to your .env file.');
  }
  return key;
}

// Lazily construct the client so a missing key fails at generation time
// (with a clear message) rather than crashing server boot.
let _ai = null;
function getClient() {
  if (!_ai) _ai = new GoogleGenAI({ apiKey: getApiKey() });
  return _ai;
}

// Models are chosen per task for cost, and pinned by exact ID so a provider
// never silently routes us to a pricier tier. All three IDs are confirmed
// available on the configured key (see README → AI models). Override via env
// if the API ever rejects an ID.
//   • GROUNDING_MODEL — competitor news with Google Search grounding. Gemini 3
//     Flash includes a free grounded-prompt quota, so at this volume it's ~$0.
//   • SYNTHESIS_MODEL — final brief prose. 2.5 Flash is the cheapest competent
//     writer here ($0.30/$2.50 per 1M vs gemini-3.5-flash's $1.50/$9.00).
// NOTE: the previous single MODEL='gemini-3.5-flash' was a valid ID but the
// 3x-pricier model — used for BOTH steps. We split it to control cost.
const GROUNDING_MODEL = process.env.GEMINI_GROUNDING_MODEL || 'gemini-3-flash-preview';
const SYNTHESIS_MODEL = process.env.GEMINI_SYNTHESIS_MODEL || 'gemini-2.5-flash';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '…';
}

// Rough chars-to-tokens estimate (4 chars ≈ 1 token)
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// Exponential backoff retry — handles 429 and transient 5xx
async function withRetry(fn, label, maxAttempts = 3) {
  let delay = 3000; // start at 3 s (was 10 s) → 6 s → 12 s
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err?.message ?? '';
      const is429 = err?.status === 429 || msg.includes('rate_limit') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429');
      const is5xx = err?.status >= 500 || msg.includes('UNAVAILABLE') || msg.includes('500') || msg.includes('503');
      if ((is429 || is5xx) && attempt < maxAttempts) {
        console.warn(`[retry] ${label} — attempt ${attempt} failed (${err.status ?? err.message}), retrying in ${delay / 1000}s`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2; // 10 s → 20 s → 40 s
      } else {
        throw err;
      }
    }
  }
}

// ─── Step B: news search ──────────────────────────────────────────────────────

async function searchCompetitorNews(name, location) {
  const prompt = `Search for news about ${name} near ${location}. Return ONLY a markdown bullet list, max 5 bullets, each under 25 words. Cover: active promos/LTOs, new menu items, local openings/closures, national news affecting traffic. No intros or explanations.`;

  console.log(`[news] ${name} — prompt ~${estimateTokens(prompt)} tokens`);

  const response = await withRetry(() => getClient().models.generateContent({
    model: GROUNDING_MODEL,
    contents: prompt,
    config: {
      // No output token cap — let the model decide length (prompt still asks
      // for a short bullet list). Disable "thinking" — this is a retrieval
      // task that doesn't need internal reasoning, and thinking was the main
      // source of multi-minute latency.
      thinkingConfig: { thinkingBudget: 0 },
      tools: [{ googleSearch: {} }], // Gemini's web-search grounding
    }
  }), `news:${name}`);

  const text = (response.text ?? '').trim();

  // Hard cap the output before it enters the synthesis prompt
  const capped = truncate(text || 'No recent news found.', 500);
  console.log(`[news] ${name} — response ~${estimateTokens(capped)} tokens (${capped.length} chars)`);
  return capped;
}

// ─── Step C: synthesis ────────────────────────────────────────────────────────

async function synthesizeBrief({ competitorData, newsData, location, sections }) {
  const sectionsToInclude = sections || ['ratings', 'news', 'recommendations'];

  // Ratings table — overall rating + total review count per competitor. The
  // "Recent Trend" column is filled by the model from the recency of the Google
  // reviews below (NOT from any prior brief).
  const ratingsTable = competitorData.map(c =>
    `${c.name} | ${c.rating ?? 'N/A'}★ | ${c.reviewCount ?? '?'} total reviews`
  ).join('\n');

  // Recent Google reviews — up to 5 each, with their recency (e.g. "a week ago")
  // and star rating, so the model can judge how each competitor's reviews are
  // trending over the last week.
  const reviewsSection = competitorData.map(c => {
    if (!c.reviews?.length) return '';
    const recent = c.reviews
      .slice(0, 5)
      .map(r => `- [${r.time ?? 'date n/a'}, ${r.rating}★] ${truncate(r.text, 120)}`)
      .join('\n');
    return `${c.name}:\n${recent}`;
  }).filter(Boolean).join('\n\n');

  // News — already capped at 500 chars each in searchCompetitorNews
  const newsSection = Object.entries(newsData)
    .map(([name, news]) => `${name}: ${news}`)
    .join('\n\n');

  const dataBlock = [
    `RATINGS:\n${ratingsTable}`,
    sectionsToInclude.includes('ratings') ? `TOP REVIEWS:\n${reviewsSection}` : '',
    sectionsToInclude.includes('news') ? `NEWS/PROMOS:\n${newsSection}` : '',
  ].filter(Boolean).join('\n\n---\n\n');

  const instructions = [
    sectionsToInclude.includes('ratings') &&
      `## SECTION 1 — RATINGS LANDSCAPE\nRender a markdown table with columns: Competitor | Rating | Total Reviews | Recent Trend. For "Recent Trend", look ONLY at the recent Google reviews in the TOP REVIEWS data — use their dates (e.g. "a week ago") and star ratings to judge how each competitor's reviews are trending in the LAST WEEK. Pick one: Improving / Declining / Stable / Few recent reviews. If there are no reviews dated within roughly the last week, use "Few recent reviews". Base this ONLY on those Google review entries — never on any previous report or brief. Then 2 sentences on who is gaining or losing momentum in recent reviews.`,
    sectionsToInclude.includes('news') &&
      `## SECTION 2 — WHAT'S HAPPENING THIS WEEK\nBullet list of active promos/new items. Flag anything competing with CFA chicken sandwiches, family meals, or catering.`,
    sectionsToInclude.includes('recommendations') &&
      `## SECTION 3 — OWNER RECOMMENDATIONS\nExactly 3 action items the owner can take THIS WEEK. Bold the action, 1–2 sentences each, tied ONLY to the data above. Focus on Chick-fil-A's own execution, value, and service — not on attacking competitors.`,
  ].filter(Boolean).join('\n\n');

  // Guardrails — the model was inventing competitor news and stating single
  // reviews as fact (e.g. "Popeyes is serving raw chicken"). Constrain it
  // strictly to the supplied data and require responsible handling of reviews.
  const rules = [
    'Use ONLY the data provided above. Do NOT invent or assume promotions, news, menu items, openings, closures, or events that are not present in the data.',
    'If the NEWS/PROMOS data is empty, missing, or says none was found, state plainly that no competitor news was available this period — and do NOT reference any competitor promotion or news anywhere else in the brief. The brief must be internally consistent.',
    'Customer reviews are anecdotal opinions from individuals, NOT verified facts. Never present a single review or complaint as an established fact about a competitor. Do NOT assert that a competitor has a food-safety failure (e.g. "serving raw chicken"). At most, note that "some reviewers mention…".',
    'Never recommend marketing against, publicizing, or "capitalizing on" a competitor\'s alleged food-safety incident or any unverified claim. Keep recommendations focused on Chick-fil-A\'s own standards.',
    'Recent review trends come ONLY from the dated Google review entries provided. There is NO previous report or earlier brief to compare against — never claim a rating "rose", "fell", or "changed" relative to a past period you were not given.',
  ].map((r, i) => `${i + 1}. ${r}`).join('\n');

  const prompt = `You are a competitive analyst for a Chick-fil-A franchise in ${location}. Data gathered today:\n\n${dataBlock}\n\nWrite the brief. Be concise. No filler.\n\nRULES (follow strictly):\n${rules}\n\n${instructions}`;

  const tokenEstimate = estimateTokens(prompt);
  console.log(`[synthesis] prompt ~${tokenEstimate} tokens`);

  const response = await withRetry(() => getClient().models.generateContent({
    model: SYNTHESIS_MODEL,
    contents: prompt,
    // No output token cap — let the model write the full brief unconstrained.
    // Small thinking budget: enough internal reasoning to keep the
    // recommendations sharp, but far cheaper/faster than unbounded thinking.
    config: { thinkingConfig: { thinkingBudget: 256 } },
  }), 'synthesis');

  return response.text;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

async function runResearchPipeline({ competitors, location, sections, emit = () => {} }) {
  // ── Step A & B run in parallel ────────────────────────────────────────────
  // Places fetches and Gemini web searches are fully independent — fire them
  // all at once instead of waiting for each one before starting the next.
  emit('progress', { step: 'ratings', status: 'running', message: `Fetching all ${competitors.length} competitors in parallel...` });
  emit('progress', { step: 'news',    status: 'running', message: `Searching news for all ${competitors.length} competitors in parallel...` });

  const [ratingsResults, newsResults] = await Promise.all([
    // Places — all competitors at once
    Promise.allSettled(
      competitors.map(name => fetchCompetitorData(name, location))
    ),
    // Gemini web search — all competitors at once
    Promise.allSettled(
      competitors.map(name =>
        searchCompetitorNews(name, location).catch(err => {
          console.error(`[news] ${name} failed:`, err.message);
          return '(news unavailable)';
        })
      )
    )
  ]);

  // Unpack ratings
  const competitorData = ratingsResults.map((result, i) => {
    const name = competitors[i];
    const data = result.status === 'fulfilled'
      ? result.value
      : { name, error: result.reason?.message ?? 'unknown error', rating: null, reviewCount: null, reviews: [] };
    if (data.error) {
      emit('progress', { step: 'ratings', status: 'running', message: `⚠️ ${name}: ${data.error}` });
    }
    return data;
  });

  const successCount = competitorData.filter(c => c.rating !== null).length;
  emit('progress', {
    step: 'ratings', status: 'done',
    message: successCount === competitorData.length
      ? `Ratings fetched for all ${successCount} competitors`
      : `Ratings fetched for ${successCount}/${competitorData.length} competitors`
  });

  // Unpack news
  const newsData = {};
  newsResults.forEach((result, i) => {
    newsData[competitors[i]] = result.status === 'fulfilled' ? result.value : '(news unavailable)';
  });

  emit('progress', { step: 'news', status: 'done', message: 'News search complete' });
  emit('progress', { step: 'synthesis', status: 'running', message: 'Gemini is writing your brief...' });

  const brief = await synthesizeBrief({ competitorData, newsData, location, sections });

  emit('progress', { step: 'synthesis', status: 'done', message: 'Brief complete' });

  return { brief, competitorData };
}

module.exports = { runResearchPipeline };
