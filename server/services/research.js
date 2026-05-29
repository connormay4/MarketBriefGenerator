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

// Single source of truth for the Gemini model used across the pipeline.
// If the API rejects this ID, try 'gemini-flash-latest' or 'gemini-2.5-flash'.
const MODEL = 'gemini-3.5-flash';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emit(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

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
    model: MODEL,
    contents: prompt,
    config: {
      // No output token cap — let the model decide length (prompt still asks
      // for a short bullet list).
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

  // Ratings table — compact one-liner per competitor.
  // Trend compares this pull's rating to the previous brief's snapshot. When
  // there is no prior data point we label it "New" (NOT "first period" / a
  // model-invented phrase). previousRating may be 0-or-null, so test != null.
  const ratingsTable = competitorData.map(c => {
    let trend;
    if (c.previousRating == null || c.rating == null) {
      trend = 'New';
    } else if (c.rating > c.previousRating) {
      trend = `Up (${c.previousRating}→${c.rating})`;
    } else if (c.rating < c.previousRating) {
      trend = `Down (${c.previousRating}→${c.rating})`;
    } else {
      trend = 'No change';
    }
    return `${c.name} | ${c.rating ?? 'N/A'}★ | ${c.reviewCount ?? '?'} reviews | ${trend}`;
  }).join('\n');

  // Reviews — max 3 per competitor, 100 chars each
  const reviewsSection = competitorData.map(c => {
    if (!c.reviews?.length) return '';
    const top3 = c.reviews
      .slice(0, 3)
      .map(r => `- ${truncate(r.text, 100)} (${r.rating}★)`)
      .join('\n');
    return `${c.name}:\n${top3}`;
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
      `## SECTION 1 — RATINGS LANDSCAPE\nRender a markdown table with columns: Competitor | Rating | Reviews | Trend. For the Trend column, copy the trend value provided for each competitor in the RATINGS data EXACTLY — do not rephrase, relabel, or invent it (e.g. keep "New" as "New", keep "Up (4.0→4.2)" verbatim). Then 2 sentences on the biggest mover.`,
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
  ].map((r, i) => `${i + 1}. ${r}`).join('\n');

  const prompt = `You are a competitive analyst for a Chick-fil-A franchise in ${location}. Data gathered today:\n\n${dataBlock}\n\nWrite the brief. Be concise. No filler.\n\nRULES (follow strictly):\n${rules}\n\n${instructions}`;

  const tokenEstimate = estimateTokens(prompt);
  console.log(`[synthesis] prompt ~${tokenEstimate} tokens`);

  const response = await withRetry(() => getClient().models.generateContent({
    model: MODEL,
    contents: prompt,
    // No output token cap — let the model write the full brief unconstrained.
  }), 'synthesis');

  return response.text;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

async function runResearchPipeline(res, { competitors, location, sections, previousSnapshots }) {
  // ── Step A & B run in parallel ────────────────────────────────────────────
  // Places fetches and Gemini web searches are fully independent — fire them
  // all at once instead of waiting for each one before starting the next.
  emit(res, 'progress', { step: 'ratings', status: 'running', message: `Fetching all ${competitors.length} competitors in parallel...` });
  emit(res, 'progress', { step: 'news',    status: 'running', message: `Searching news for all ${competitors.length} competitors in parallel...` });

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
    data.previousRating = previousSnapshots[name]?.rating ?? null;
    if (data.error) {
      emit(res, 'progress', { step: 'ratings', status: 'running', message: `⚠️ ${name}: ${data.error}` });
    }
    return data;
  });

  const successCount = competitorData.filter(c => c.rating !== null).length;
  emit(res, 'progress', {
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

  emit(res, 'progress', { step: 'news', status: 'done', message: 'News search complete' });
  emit(res, 'progress', { step: 'synthesis', status: 'running', message: 'Gemini is writing your brief...' });

  const brief = await synthesizeBrief({ competitorData, newsData, location, sections });

  emit(res, 'progress', { step: 'synthesis', status: 'done', message: 'Brief complete' });

  return { brief, competitorData };
}

module.exports = { runResearchPipeline };
