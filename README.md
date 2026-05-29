# CFA Market Intel — Competitor Research Tool

An on-demand competitive intelligence tool for Chick-fil-A franchise owners. Pulls live Google Places data and uses Claude AI with web search to generate a clean 5-minute competitive brief.


## Quick Start

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
```
GEMINI_API_KEY=AIza...
GOOGLE_PLACES_API_KEY=AIza...
LOCATION="Atlanta, GA 30301"
PORT=3001
```

### 3. Run

```bash
npm run dev
```

Open **http://localhost:3000** — click **Generate New Brief**.

---

## Getting API Keys

### Google Places API Key

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or select an existing one)
3. Enable these APIs:
   - **Places API**
   - **Places API (New)** (if available in your region)
4. Go to **Credentials → Create Credentials → API Key**
5. Optionally restrict the key to Places API only
6. Paste the key into `.env` as `GOOGLE_PLACES_API_KEY`

**Cost note:** The Places Text Search costs ~$0.017/request and Details costs ~$0.017/request. A full brief generation makes ~10 Places calls total — about $0.17 per brief.

### Gemini API Key

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Create an API key (Google AI Studio)
3. Paste into `.env` as `GEMINI_API_KEY`

The pipeline uses the `gemini-3.5-flash` model with Google Search grounding for the news/promotions step. The model ID is set in one place — `MODEL` at the top of `server/services/research.js`. If the API rejects it, switch to `gemini-flash-latest` or `gemini-2.5-flash`.

---

## How to Find Competitor Place IDs for Your City

The app uses Google Places Text Search to automatically find the nearest location of each competitor to your `LOCATION`. You don't need to hardcode Place IDs.

To verify it's finding the right location, you can test manually:
```
https://maps.googleapis.com/maps/api/place/textsearch/json?query=McDonald%27s+near+Atlanta+GA&key=YOUR_KEY
```

If the wrong location appears (e.g., it finds a location across town instead of the one closest to your store), you can update the `LOCATION` in `.env` to use a more specific address.

---

## Folder Structure

```
/client         React + Tailwind frontend (Vite)
/server         Express API + research pipeline
  /routes       REST endpoints (briefs, settings)
  /services     Google Places fetcher, Claude research pipeline
/data           SQLite database (auto-created on first run)
.env.example    Environment variable template
```

## Running Your First Brief

1. Make sure `.env` is configured with valid API keys
2. Run `npm run dev`
3. Open http://localhost:3000
4. Click **Generate New Brief**
5. Watch the 3-step progress indicator as it:
   - Fetches ratings from Google Places (~5 competitors)
   - Searches news/promotions via Claude web search
   - Synthesizes the brief with Claude
6. Read the brief — Recommendations section is expanded first

## Settings

Click the gear icon in the sidebar to:
- Change your location
- Add/remove/disable competitors
- Toggle which brief sections to include

## PDF Export

Click **Export PDF** on any brief to open the browser print dialog. The print stylesheet hides the sidebar and navigation for a clean single-column document.
