# IMDb Insights

Minimal Next.js app: enter an IMDb ID (e.g., `tt0133093`) and fetches movie details, scrapes audience reviews, runs sentiment analysis, and optionally uses OpenAI to produce a short AI summary.

Features:
- Input: IMDb movie ID
- Scrapes movie page and reviews from IMDb
- Performs audience sentiment analysis (fallback to local sentiment library)
- Optional OpenAI summarization (set `OPENAI_API_KEY`)
- Responsive React UI (Next.js + TypeScript)

Setup

1. Install deps

```bash
npm install
```

2. (Optional) Set environment variables

Create a `.env.local` in the project root:

```
OPENAI_API_KEY=sk-...
OMDB_API_KEY=your_omdb_key  # get a free key from http://www.omdbapi.com/apikey.aspx
```

IMDb aggressively protects its pages with AWS WAF and Cloudflare; if scraping returns a challenge or empty HTML, the server will fall back to OMDb metadata when `OMDB_API_KEY` is provided. Reviews are still scraped directly and may not always be available.

3. Run dev server

```bash
npm run dev
```

Open http://localhost:3000 and enter an IMDb ID like `tt0133093`.

Notes
- IMDb HTML structure may change; scraping is resilient to several common layouts but may require tweaks.
- If `OPENAI_API_KEY` is set the app will attempt a richer AI summary. Without it the app uses the `sentiment` package to summarize audience sentiment.
