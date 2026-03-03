import type { NextApiRequest, NextApiResponse } from 'next'
import { load } from 'cheerio'
import Sentiment from 'sentiment'
import OpenAI from 'openai'

const sentiment = new Sentiment()

type Data = {
  title?: string
  poster?: string
  year?: string
  rating?: string
  plot?: string
  cast?: string[]
  reviews?: string[]
  sentiment?: {
    score: number | null
    classification: 'positive' | 'mixed' | 'negative'
    summary: string
  }
  error?: string
}

async function fetchHtml(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9', Referer:'https://www.imdb.com/' } })
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return res.text()
}

function looksLikeChallenge(html: string) {
  // AWS WAF challenge or Cloudflare bot page includes particular markers
  return html.includes('AwsWafIntegration') || html.includes('JavaScript is disabled') || html.includes('challenge.js')
}

async function scrapeImdb(imdbId: string) {
  const base = `https://www.imdb.com/title/${imdbId}`
  const html = await fetchHtml(base)

  if (looksLikeChallenge(html)) {
    // try OMDb fallback if key present
    const key = process.env.OMDB_API_KEY
    if (key) {
      try {
        const omdbRes = await fetch(`http://www.omdbapi.com/?i=${imdbId}&apikey=${key}&plot=short`)
        const omdb = await omdbRes.json()
        return {
          title: omdb.Title || '',
          poster: omdb.Poster && omdb.Poster !== 'N/A' ? omdb.Poster : '',
          plot: omdb.Plot && omdb.Plot !== 'N/A' ? omdb.Plot : '',
          year: omdb.Year || '',
          rating: omdb.imdbRating || '',
          cast: (omdb.Actors ? omdb.Actors.split(',').map((s:string)=>s.trim()) : []).slice(0,12)
        }
      } catch (e) {
        // fallback to empty fields
      }
    }
    // without OMDb, just return empty
    return { title: '', poster: '', plot: '', year: '', rating: '', cast: [] }
  }

  const $ = load(html)

  const title = $('meta[property="og:title"]').attr('content') || $('title').text()
  const poster = $('meta[property="og:image"]').attr('content') || ''
  const plot = $('meta[name="description"]').attr('content') || $('div.summary_text').text().trim()
  const year = $('span[id="titleYear"]').text().replace(/[()]/g, '').trim() || $('ul[data-testid="hero-title-block__metadata"] li').first().text().trim()
  const rating = $('span[itemprop="ratingValue"]').first().text().trim() || $('div[data-testid="hero-rating-bar__aggregate-rating__score"] span').first().text().trim()

  // Cast: try common selectors
  const cast: string[] = []
  $('table.cast_list tr').each((i, el) => {
    const name = $(el).find('td:not(.character)').text().trim().replace(/\s+/g, ' ')
    if (name) cast.push(name)
  })
  if (cast.length === 0) {
    $('div[data-testid="title-cast"] a[data-testid="title-cast-item__actor"]').each((i, el) => {
      const n = $(el).text().trim()
      if (n) cast.push(n)
    })
  }

  return { title, poster, plot, year, rating, cast: cast.slice(0, 12) }
}

async function scrapeReviews(imdbId: string) {
  const url = `https://www.imdb.com/title/${imdbId}/reviews?ref_=tt_urv`
  const html = await fetchHtml(url)
  if (looksLikeChallenge(html)) {
    return []
  }
  const $ = load(html)
  const reviews: string[] = []

  // IMDb uses a few different structures; try multiple selectors
  $('div.review-container').each((i, el) => {
    const text = $(el).find('.text.show-more__control').text().trim() || $(el).find('.content .text').text().trim()
    if (text) reviews.push(text)
  })

  if (reviews.length === 0) {
    $('div.lister-item-content').each((i, el) => {
      const text = $(el).find('.content .text').text().trim()
      if (text) reviews.push(text)
    })
  }

  // Fallback: grab any <div class="text show-more__control">
  if (reviews.length === 0) {
    $('div.text.show-more__control').each((i, el) => {
      const t = $(el).text().trim()
      if (t) reviews.push(t)
    })
  }

  return reviews.slice(0, 60)
}

async function summarizeWithOpenAI(reviews: string[], imdbId: string) {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  const client = new OpenAI({ apiKey: key })

  const sample = reviews.slice(0, 20).join('\n\n')

  // Ask the model to return strict JSON for easy parsing
  const system = `You are a JSON-only responder. When given user reviews, return a single valid JSON object with the following keys:\n- summary: short 2-3 sentence summary of overall audience sentiment\n- classification: one of \"positive\", \"mixed\", or \"negative\"\n- praises: array of top 3 recurring praises (short phrases)\n- criticisms: array of top 3 recurring criticisms (short phrases)\nRespond with only valid JSON and nothing else.`

  const user = `IMDb ID: ${imdbId}\n\nUser reviews:\n${sample}`

  try {
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.2,
      max_tokens: 600
    })

    const text = resp.choices?.[0]?.message?.content || ''

    // Try to parse as JSON directly, otherwise attempt to extract JSON block
    try {
      return JSON.parse(text)
    } catch (e) {
      const m = text.match(/\{[\s\S]*\}/)
      if (m) {
        try { return JSON.parse(m[0]) } catch (e2) { return null }
      }
      return null
    }
  } catch (err) {
    return null
  }
}

function basicSummaryFromSentiment(reviews: string[], avgScore: number) {
  const top = reviews.slice(0, 6)
  const polarity = avgScore > 0.5 ? 'positive' : avgScore < -0.5 ? 'negative' : 'mixed'
  const summary = `Avg sentiment score ${avgScore.toFixed(2)} — audience sentiment appears ${polarity}. Sample reactions: ${top.map(r => r.slice(0, 120)).join(' | ')}.`
  return { classification: polarity as 'positive' | 'mixed' | 'negative', summary }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
  const imdbId = (req.query.imdbId as string || '').trim()
  if (!imdbId || !/^tt\d{7,}$/.test(imdbId)) {
    res.status(400).json({ error: 'Provide a valid IMDb ID like tt0133093' })
    return
  }

  try {
    const movie = await scrapeImdb(imdbId)
    const reviews = await scrapeReviews(imdbId)

    // Sentiment analysis – if we couldn't fetch any reviews, return a neutral/empty result
    let finalScore: number | null = null
    let classification: 'positive' | 'mixed' | 'negative' = 'mixed'
    let summaryText = ''
    let praises: string[] = []
    let criticisms: string[] = []

    if (reviews.length > 0) {
      const scores = reviews.map(r => sentiment.analyze(r).comparative).filter(s => !isNaN(s))
      const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
      finalScore = isNaN(avgScore) ? 0 : Number(avgScore.toFixed(3))

      // Try OpenAI summarization if key provided
      const aiSummary = await summarizeWithOpenAI(reviews, imdbId)
      if (aiSummary) {
        // aiSummary expected to be parsed JSON
        try {
          classification = (aiSummary.classification || (Math.sign(avgScore) >= 0 ? 'positive' : 'negative')) as any
          summaryText = aiSummary.summary || ''
          praises = Array.isArray(aiSummary.praises) ? aiSummary.praises : []
          criticisms = Array.isArray(aiSummary.criticisms) ? aiSummary.criticisms : []
        } catch (e) {
          const s = basicSummaryFromSentiment(reviews, avgScore)
          classification = s.classification
          summaryText = s.summary
        }
      } else {
        const s = basicSummaryFromSentiment(reviews, avgScore)
        classification = s.classification
        summaryText = s.summary
      }
    } else {
      // no reviews found; give a fallback message
      summaryText = 'No audience reviews could be scraped.'
      classification = 'mixed'
    }

    const response: any = {
      title: movie.title,
      poster: movie.poster,
      year: movie.year,
      rating: movie.rating,
      plot: movie.plot,
      cast: movie.cast,
      reviews,
      sentiment: { score: finalScore, classification, summary: summaryText },
      praises: Array.isArray(praises) ? praises.filter(p => typeof p === 'string' && p.trim()) : [],
      criticisms: Array.isArray(criticisms) ? criticisms.filter(c => typeof c === 'string' && c.trim()) : []
    }

    // if we got basically nothing and no OMDb key provided, give a hint
    if (!movie.title && !movie.poster && !process.env.OMDB_API_KEY) {
      response.error = 'IMDb blocked scraping; set OMDB_API_KEY for fallback or try again later.'
    }

    res.status(200).json(response)
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) })
  }
}
