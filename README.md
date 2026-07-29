# CFA Market Intel — Weekly Competitive Brief

> **⚠️ The weekly email is turned OFF.** The Vercel Cron entry has been removed from `vercel.json` and the job is additionally gated behind `WEEKLY_EMAIL_ENABLED`. Nothing sends on a schedule. On-demand brief generation and the manual "send" / "test email" buttons still work. See [Turning the weekly email back on](#turning-the-weekly-email-back-on).

An operator-grade competitive-intelligence tool for a Chick-fil-A franchise (built for **Hanover, PA 17331**). It generates a beautifully-designed brief on demand (weekly emailing is currently disabled), covering:

- **You vs nearby Chick-fil-As** — ranks your store against the **24 closest CFAs** on overall rating, recent review volume, and review-derived **speed, accuracy, taste, and courtesy** (e.g. "#2 of 23 on courteous team").
- **Your store this week** — your Google rating, a notable praise, a notable concern, and one action prompt.
- **Local pricing** — each competitor's signature chicken sandwich (or #1 meal) price in Hanover, operator-verified with confidence + last-verified date.
- **Breakfast hub** — a few realistic, operator-executable ideas to grow the morning daypart (reward levers only — no menu/price changes).
- **The brief** — ratings landscape, what's happening this week, and owner recommendations.

Everything runs on **Vercel only** (no Railway): a static React front end + an Express API as one serverless function. (A weekly Vercel Cron used to email the brief; it is now disabled.)

---

## Architecture

```
Browser ── Vercel ──┬─ /            → static React build (client/dist)
                    └─ /api/*       → Express function (api/index.js → server/index.js)
                         • /briefs/generate (SSE)  on-demand brief
                         • /rankings/refresh (SSE)  25-CFA ranking
                         • /cron/weekly  ← Vercel Cron (Mon 13:00 UTC) + CRON_SECRET
Data: Turso (libSQL) · Email: Resend · Reviews: Outscraper (+ Places fallback) · LLM: Gemini
```

- **Backend** = the Express app exported by `server/index.js`, re-exported at `api/index.js` and routed by `vercel.json`.
- **Storage** = Turso (hosted libSQL). Locally it falls back to a `./data/briefs.db` file automatically — no Turso account needed for dev.
- **Weekly job** = `vercel.json` cron → `/api/cron/weekly` (secured by `CRON_SECRET`, idempotent per ISO week) → refresh ranking → assemble brief → email via Resend.

---

## Setup checklist

You need these accounts/keys. Add each to **Vercel → Project → Settings → Environment Variables** (and to a local `.env` for dev — copy `.env.example`).

| Service | Env var(s) | Notes |
|---|---|---|
| **Google AI (Gemini)** | `GEMINI_API_KEY` | **Enable billing** on the key — the free tier's 250 requests/day can't sustain review classification. Usage is still pennies/week. |
| **Google Places** | `GOOGLE_PLACES_API_KEY` | Enable **Places API (New)** (used for the 24-nearest-CFA discovery) and Places API. |
| **Turso** (storage) | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Free tier is plenty. `turso db create`, then `turso db show --url` and `turso db tokens create`. Omit locally to use a file DB. |
| **Resend** (email) | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_TO` | Free tier (3,000/mo). Verify a sending domain (SPF/DKIM/DMARC) for `EMAIL_FROM`; until then you can send from `onboarding@resend.dev`. `EMAIL_TO=jack.stefano@cfafranchisee.com`. |
| **Cron secret** | `CRON_SECRET` | Any long random string. Vercel Cron sends it as `Authorization: Bearer …`; the endpoint rejects anything else. |
| **Outscraper** (reviews) | `OUTSCRAPER_API_KEY` | **Optional but recommended (~$5/mo).** Without it, ranking falls back to Google's 5-reviews/place and aspect ranks show "Insufficient data." |
| **Your store** | `STORE_PLACE_ID` | Optional. Jack's CFA Place ID to anchor discovery precisely. If unset, the nearest CFA to `LOCATION` is used. |
| **Location** | `LOCATION` | `"Hanover, PA 17331"`. |

**Two cost decisions** (both reversible):
- **Outscraper (~$5/mo)** for credible aspect ranks vs the free Places fallback (overall + volume ranks only). *Third-party review scraping breaches Google's ToS — low practical risk for an internal single-operator tool; keep the data internal.*
- **Vercel Pro ($20/mo)** for an 800s function limit + minute-precise cron, vs **Hobby (free)** which works for the weekly email but caps functions at 300s (heavy Outscraper runs may need the stepped/chunked path).

---

## AI models per task (impartial, June 2026)

| Task | Model | Why | Override |
|---|---|---|---|
| Web-grounded news | **Gemini 3 Flash** (`gemini-3-flash-preview`) + Google Search | Free grounded-prompt quota → ~$0 at this volume | `GEMINI_GROUNDING_MODEL` |
| Review classification | **Gemini 2.5 Flash-Lite** ($0.10/$0.40) — or **GPT-5 Nano** ($0.05/$0.40) for the cheapest path | Batched ~20/call; pennies/week | `GEMINI_CLASSIFY_MODEL` / `OPENAI_API_KEY` |
| Brief + breakfast prose | **Gemini 2.5 Flash** ($0.30/$2.50) | Cheapest competent writer here | `GEMINI_SYNTHESIS_MODEL` |

Total AI cost is **well under $1/week**. (Picks are by genuine cost/fit; e.g. `gemini-3.5-flash` is avoided — it's 3× the price of `gemini-3-flash-preview`.)

---

## Local development

```bash
npm run install:all
cp .env.example .env      # add GEMINI_API_KEY + GOOGLE_PLACES_API_KEY at minimum
npm run dev               # client on :3000 (proxies /api to :3001)
```

- No Turso/Resend/Outscraper keys needed locally — storage uses `./data/briefs.db`, email dry-runs, and reviews fall back to Google Places.
- Generate a brief from the UI, then click **Run ranking** on the rank board.

Useful endpoints for testing:
```bash
# Weekly job without sending email (force past the once-per-week lock):
curl -X POST "http://localhost:3001/api/cron/weekly?force=1&send=0&key=$CRON_SECRET"
# Preview the rendered HTML email of the latest brief:
open  "http://localhost:3001/api/cron/preview?key=$CRON_SECRET"
```

---

## Deploy to Vercel

1. Import the repo in Vercel (root directory = repo root). The build command (`npm run build`) and output (`client/dist`) are set in `vercel.json`.
2. Add all env vars from the checklist.
3. Deploy. The weekly cron (`vercel.json` → `0 13 * * 1`, Mondays) is registered automatically.
4. Verify: open the deployed URL, generate a brief, run the ranking; then trigger the weekly job once: `curl -X POST "https://<your-app>/api/cron/weekly?force=1&key=$CRON_SECRET"` and confirm the email arrives.

---

## How the 25-CFA ranking stays honest

- **Aspect ranks** use the **Wilson lower bound** of positive review share, so a store with many consistent reviews beats one with a couple of lucky ones.
- Stores below a **minimum-mentions threshold** show **"Insufficient data"** rather than a guessed rank.
- **"Reviews this past month"** is raw volume (context), not a quality score.
- Every rank shows the **n** it's based on, and ranks are labeled **directional, not audited**.
- **CFA internal data (future hook):** `PUT /api/settings/internal-data` with `[{category,rank,of,percentile,note}]` supplies authoritative **"measured"** ranks for your store (from CEM/OSAT) that supersede the inferred public-review ranks and are badged **MEASURED** in the report. Categories: `overall`, `month`, `speed`, `accuracy`, `taste`, `courtesy`.

---

## Folder structure

```
/api/index.js          Vercel entry (re-exports the Express app)
/server
  index.js             Express app (exported; serves client/dist in prod)
  db.js                libSQL (Turso / local file), schema, query helpers
  /routes              briefs · settings · cron · rankings
  /services            research · brief · pricing · breakfast · ownStore ·
                       email · discovery · reviews · classify · ranking · rankingJob · gemini
/client                React + Vite + Tailwind front end
vercel.json            build, /api routing, weekly cron, function maxDuration
```
