const { GoogleGenAI } = require('@google/genai');

// Shared Gemini client + per-task model IDs. Pinned for cost; all confirmed
// available on the configured key. Override via env if an ID is ever rejected.
const MODELS = {
  grounding: process.env.GEMINI_GROUNDING_MODEL || 'gemini-3-flash-preview', // web-grounded retrieval
  synthesis: process.env.GEMINI_SYNTHESIS_MODEL || 'gemini-2.5-flash',       // prose
  classify:  process.env.GEMINI_CLASSIFY_MODEL  || 'gemini-2.5-flash-lite',  // high-volume classification
};

function getApiKey() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key || key.startsWith('your_')) {
    throw new Error('GEMINI_API_KEY is not configured. Add a valid Google AI Studio key to your .env file.');
  }
  return key;
}

let _ai = null;
function getClient() {
  if (!_ai) _ai = new GoogleGenAI({ apiKey: getApiKey() });
  return _ai;
}

// Exponential backoff for 429 / transient 5xx.
async function withRetry(fn, label, maxAttempts = 3) {
  let delay = 2000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err?.message ?? '';
      const retryable =
        err?.status === 429 || err?.status >= 500 ||
        /rate_limit|RESOURCE_EXHAUSTED|429|UNAVAILABLE|503|500/.test(msg);
      if (retryable && attempt < maxAttempts) {
        console.warn(`[gemini] ${label} attempt ${attempt} failed (${err.status ?? msg}); retry in ${delay / 1000}s`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
}

async function generateText(model, prompt, config = {}) {
  const res = await withRetry(
    () => getClient().models.generateContent({ model, contents: prompt, config }),
    `text:${model}`
  );
  return (res.text ?? '').trim();
}

// Request strict JSON. We set responseMimeType=application/json (broadly
// supported across SDK versions) and parse defensively, tolerating any stray
// markdown fencing. Returns the parsed value or throws with the raw text.
async function generateJSON(model, prompt, { thinkingBudget = 0, ...rest } = {}) {
  const text = await generateText(model, prompt, {
    responseMimeType: 'application/json',
    thinkingConfig: { thinkingBudget },
    ...rest,
  });
  return parseJSON(text);
}

function parseJSON(text) {
  if (!text) throw new Error('Empty model response');
  let s = text.trim();
  // Strip ```json ... ``` fences if present.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    // Last resort: grab the outermost {...} or [...] span.
    const span = s.match(/[[{][\s\S]*[\]}]/);
    if (span) return JSON.parse(span[0]);
    throw new Error('Model did not return valid JSON: ' + s.slice(0, 200));
  }
}

module.exports = { getClient, withRetry, generateText, generateJSON, parseJSON, MODELS };
