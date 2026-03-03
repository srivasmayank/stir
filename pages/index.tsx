import React, { useState } from 'react'

type MovieResp = {
  title?: string
  poster?: string
  year?: string
  rating?: string
  plot?: string
  cast?: string[]
  reviews?: string[]
  sentiment?: { score: number | null; classification: string; summary: string }
  error?: string
}

export default function Home() {
  const [imdbId, setImdbId] = useState('')
  const [data, setData] = useState<MovieResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchMovie(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    if (!/^tt\d{7,}$/.test(imdbId.trim())) {
      setError('Enter a valid IMDb ID (e.g., tt0133093)')
      return
    }
    setLoading(true)
    setData(null)
    try {
      const res = await fetch(`/api/movie?imdbId=${encodeURIComponent(imdbId)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to fetch')
      setData(json)
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <header className="header">
        <h1>IMDb Insights</h1>
        <p className="lead">Enter an IMDb ID to fetch movie details and audience sentiment.</p>
      </header>

      <form className="search" onSubmit={fetchMovie}>
        <input
          suppressHydrationWarning
          aria-label="IMDb ID"
          placeholder="Enter IMDb ID (e.g., tt0133093)"
          value={imdbId}
          onChange={(e) => setImdbId(e.target.value)}
        />
        <button type="submit" disabled={loading}>Analyze</button>
      </form>

      {error && <div className="error">{error}</div>}

      {loading && <div className="loader">Loading…</div>}

      {data && (
       <>
         {data.error && <div className="error">{data.error}</div>}
         <main className="card">
          <div className="media">
            {data.poster ? <img src={data.poster} alt={data.title} /> : <div className="posterPlaceholder">No poster</div>}
          </div>
          <div className="meta">
            <h2>{data.title} <span className="muted">({data.year})</span></h2>
            <div className="rating">IMDb: <strong>{data.rating || '—'}</strong></div>
            <p className="plot">{data.plot}</p>

            <section>
              <h3>Top Cast</h3>
              <ul className="cast">
                {(data.cast || []).map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </section>

            <section>
              <h3>Audience Sentiment</h3>
              <div className={`sentiment ${data.sentiment?.classification}`}>{data.sentiment?.classification?.toUpperCase() || 'UNKNOWN'}</div>
              <p className="sentSummary">{data.sentiment?.summary || 'No sentiment data available.'}</p>
              {/* ensure we render a real number; parse anything we get and fall back gracefully */}
              {(() => {
                const raw = data.sentiment?.score
                const score = typeof raw === 'number' ? raw : Number(raw) // coerce strings
                const hasValue = score !== null && Number.isFinite(score)
                return (
                  <p className="sentScore">
                    Score: {hasValue ? score : '—'}
                    {!hasValue && <span className="muted"> (no reviews)</span>}
                  </p>
                )
              })()}
            </section>

            {(data.praises || []).length > 0 && (
              <section>
                <h3>What audiences praised</h3>
                <ul className="praiseList">
                  {data.praises?.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </section>
            )}

            {(data.criticisms || []).length > 0 && (
              <section>
                <h3>Common criticisms</h3>
                <ul className="critList">
                  {data.criticisms?.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </section>
            )}

            <section>
              <h3>Sample Reviews</h3>
              <div className="reviews">
                {(data.reviews || []).filter(r => typeof r === 'string' && r.trim()).slice(0, 6).map((r, i) => (
                  <blockquote key={i}>{r}</blockquote>
                ))}
              </div>
            </section>
          </div>
        </main>
        </>
      )}

    </div>
  )
}
