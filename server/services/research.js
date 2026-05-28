const Anthropic = require('@anthropic-ai/sdk');
const { fetchCompetitorData } = require('./places');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
  let delay = 10000; // start at 10 s
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err?.status === 429 || err?.message?.includes('rate_limit');
      const is5xx = err?.status >= 500;
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
  const messages = [
    {
      role: 'user',
      content: `Search for news about ${name} near ${location}. Return ONLY a markdown bullet list, max 5 bullets, each under 25 words. Cover: active promos/LTOs, new menu items, local openings/closures, national news affecting traffic. No intros or explanations.`
    }
  ];

  console.log(`[news] ${name} — prompt ~${estimateTokens(messages[0].content.text ?? messages[0].content)} tokens`);

  const response = await withRetry(() => client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300, // tight cap — we only want a short bullet list
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages
  }), `news:${name}`);

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  // Hard cap the output before it enters the synthesis prompt
  const capped = truncate(text || 'No recent news found.', 500);
  console.log(`[news] ${name} — response ~${estimateTokens(capped)} tokens (${capped.length} chars)`);
  return capped;
}

// ─── Step C: synthesis ────────────────────────────────────────────────────────

async function synthesizeBrief({ competitorData, newsData, location, sections }) {
  const sectionsToInclude = sections || ['ratings', 'news', 'recommendations'];

  // Ratings table — compact one-liner per competitor
  const ratingsTable = competitorData.map(c => {
    const trend = c.previousRating
      ? c.rating > c.previousRating ? `▲${c.previousRating}→${c.rating}`
        : c.rating < c.previousRating ? `▼${c.previousRating}→${c.rating}`
        : '→ same'
      : 'first';
    return `${c.name}: ${c.rating ?? 'N/A'}★ (${c.reviewCount ?? '?'} reviews) ${trend}`;
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
      `## SECTION 1 — RATINGS LANDSCAPE\nTable: name | rating | reviews | trend. Then 2 sentences on the biggest mover.`,
    sectionsToInclude.includes('news') &&
      `## SECTION 2 — WHAT'S HAPPENING THIS WEEK\nBullet list of active promos/new items. Flag anything competing with CFA chicken sandwiches, family meals, or catering.`,
    sectionsToInclude.includes('recommendations') &&
      `## SECTION 3 — OWNER RECOMMENDATIONS\nExactly 3 action items the owner can take THIS WEEK. Bold the action, 1–2 sentences each, tied to the data.`,
  ].filter(Boolean).join('\n\n');

  const prompt = `You are a competitive analyst for a Chick-fil-A franchise in ${location}. Data gathered today:\n\n${dataBlock}\n\nWrite the brief. Be concise. No filler.\n\n${instructions}`;

  const tokenEstimate = estimateTokens(prompt);
  console.log(`[synthesis] prompt ~${tokenEstimate} tokens`);

  const response = await withRetry(() => client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024, // down from 2048 — brief output only
    messages: [{ role: 'user', content: prompt }]
  }), 'synthesis');

  return response.content[0].text;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

async function runResearchPipeline(res, { competitors, location, sections, previousSnapshots }) {
  emit(res, 'progress', { step: 'ratings', status: 'running', message: 'Fetching competitor ratings from Google Places...' });

  const competitorData = [];
  for (const name of competitors) {
    emit(res, 'progress', { step: 'ratings', status: 'running', message: `Fetching ${name}...` });
    const data = await fetchCompetitorData(name, location);
    data.previousRating = previousSnapshots[name]?.rating ?? null;
    // Surface Places errors immediately in the UI so the owner knows why ratings are missing
    if (data.error) {
      emit(res, 'progress', { step: 'ratings', status: 'running', message: `⚠️ ${name}: ${data.error}` });
    }
    competitorData.push(data);
  }

  const successCount = competitorData.filter(c => c.rating !== null).length;
  const doneMsg = successCount === competitorData.length
    ? `Fetched ratings for all ${successCount} competitors`
    : `Fetched ratings for ${successCount}/${competitorData.length} competitors — check server log for errors`;
  emit(res, 'progress', { step: 'ratings', status: 'done', message: doneMsg });
  emit(res, 'progress', { step: 'news', status: 'running', message: 'Searching for news and promotions...' });

  const newsData = {};
  for (const name of competitors) {
    emit(res, 'progress', { step: 'news', status: 'running', message: `Searching news for ${name}...` });
    try {
      newsData[name] = await searchCompetitorNews(name, location);
    } catch (err) {
      // Graceful fallback — don't let one failed search kill the whole brief
      console.error(`[news] ${name} failed:`, err.message);
      newsData[name] = '(news unavailable)';
    }
  }

  emit(res, 'progress', { step: 'news', status: 'done', message: 'News search complete' });
  emit(res, 'progress', { step: 'synthesis', status: 'running', message: 'Claude is writing your brief...' });

  const brief = await synthesizeBrief({ competitorData, newsData, location, sections });

  emit(res, 'progress', { step: 'synthesis', status: 'done', message: 'Brief complete' });

  return { brief, competitorData };
}

module.exports = { runResearchPipeline };
