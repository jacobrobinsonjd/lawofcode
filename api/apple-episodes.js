// /api/apple-episodes.js
// Fetches the Law of Code podcast's episode list from Apple's iTunes Lookup API.
// Returns a map of episode title -> Apple Podcasts episode URL.
// Cached aggressively since Apple's episode list changes slowly.

const APPLE_SHOW_ID = '1578287932';
const LOOKUP_URL = `https://itunes.apple.com/lookup?id=${APPLE_SHOW_ID}&media=podcast&entity=podcastEpisode&limit=200`;
const FETCH_TIMEOUT_MS = 8000;

export default async function handler(req, res) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const appleRes = await fetch(LOOKUP_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; lawofcode.fm/1.0; +https://lawofcode.fm)',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!appleRes.ok) {
      return res.status(502).json({
        error: 'Apple lookup failed',
        status: appleRes.status,
      });
    }

    const data = await appleRes.json();
    const results = data.results || [];

    // First result is the show itself; rest are episodes
    const episodes = results.filter(r => r.wrapperType === 'podcastEpisode');

    // Build a map: normalized-title -> apple episode URL
    const map = {};
    episodes.forEach(ep => {
      if (ep.trackName && ep.trackViewUrl) {
        const key = normalizeTitle(ep.trackName);
        map[key] = ep.trackViewUrl;
      }
    });

    // Cache for 24h at edge (Apple episode data changes slowly)
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({ episodes: map, count: episodes.length });
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err && err.name === 'AbortError';
    return res.status(500).json({
      error: isAbort ? 'Apple request timed out' : 'Server error',
      message: err && err.message ? err.message : String(err),
    });
  }
}

// Normalize titles for matching: lowercase, strip "#NNN -" prefixes, collapse whitespace, strip punctuation
function normalizeTitle(s) {
  return String(s)
    .toLowerCase()
    .replace(/^#?\d+\s*[-–—:]\s*/, '')
    .replace(/^interview:\s*/i, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
