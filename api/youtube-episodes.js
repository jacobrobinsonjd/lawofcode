// /api/youtube-episodes.js
// Fetches the Law of Code YouTube channel's videos via YouTube Data API v3.
// Returns a map of normalized-title -> YouTube video URL.
// API key is read from environment variable YOUTUBE_API_KEY (never hardcoded).
// Cached for 6 hours since new episodes are published weekly.

const CHANNEL_HANDLE = '@lawofcodeFM';
const FETCH_TIMEOUT_MS = 8000;
const MAX_RESULTS = 50; // API max per page

export default async function handler(req, res) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'YOUTUBE_API_KEY not configured' });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // Step 1: Resolve the channel handle to a channel ID
    // The `forHandle` parameter accepts the handle without the @ sign
    const handleParam = CHANNEL_HANDLE.replace(/^@/, '');
    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=${encodeURIComponent(handleParam)}&key=${apiKey}`;

    const channelRes = await fetch(channelUrl, { signal: controller.signal });
    if (!channelRes.ok) {
      const errText = await channelRes.text().catch(() => '');
      clearTimeout(timeoutId);
      return res.status(502).json({
        error: 'Channel lookup failed',
        status: channelRes.status,
        body: errText.slice(0, 300),
      });
    }

    const channelData = await channelRes.json();
    const items = channelData.items || [];
    if (items.length === 0) {
      clearTimeout(timeoutId);
      return res.status(404).json({ error: 'Channel not found', handle: CHANNEL_HANDLE });
    }

    const uploadsPlaylistId = items[0].contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      clearTimeout(timeoutId);
      return res.status(502).json({ error: 'No uploads playlist found' });
    }

    // Step 2: Fetch the uploads playlist (all channel videos in reverse chronological order)
    const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=${MAX_RESULTS}&key=${apiKey}`;

    const playlistRes = await fetch(playlistUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!playlistRes.ok) {
      const errText = await playlistRes.text().catch(() => '');
      return res.status(502).json({
        error: 'Playlist fetch failed',
        status: playlistRes.status,
        body: errText.slice(0, 300),
      });
    }

    const playlistData = await playlistRes.json();
    const videos = playlistData.items || [];

    // Build a normalized-title -> URL map
    const map = {};
    videos.forEach(item => {
      const title = item.snippet?.title;
      const videoId = item.snippet?.resourceId?.videoId;
      if (title && videoId) {
        const key = normalizeTitle(title);
        // Only set if not already present — first occurrence wins (which is the newest)
        if (!map[key]) {
          map[key] = `https://www.youtube.com/watch?v=${videoId}`;
        }
      }
    });

    // Cache for 6h at edge
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ episodes: map, count: videos.length });
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err && err.name === 'AbortError';
    return res.status(500).json({
      error: isAbort ? 'YouTube request timed out' : 'Server error',
      message: err && err.message ? err.message : String(err),
    });
  }
}

// Normalize titles for matching against curated episode titles.
// Matches the same normalization used in apple-episodes.js and index.html.
function normalizeTitle(s) {
  return String(s)
    .toLowerCase()
    .replace(/^#?\d+\s*[-–—:]\s*/, '')
    .replace(/^ep(?:isode)?\.?\s*\d+\s*[-–—:]\s*/i, '')
    .replace(/^interview:\s*/i, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
