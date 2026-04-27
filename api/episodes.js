// /api/episodes.js
// Fetches the Law of Code RSS feed, parses it, returns latest episodes as JSON.
// Cached for 30 minutes via Cache-Control header so Vercel's edge serves it fast.

const FEED_URL = 'https://anchor.fm/s/5e2873d8/podcast/rss';
const MAX_EPISODES = 4;

export default async function handler(req, res) {
  try {
    const feedRes = await fetch(FEED_URL, {
      headers: { 'User-Agent': 'lawofcode.fm/1.0' },
    });

    if (!feedRes.ok) {
      return res.status(502).json({ error: 'Feed fetch failed' });
    }

    const xml = await feedRes.text();

    // Lightweight RSS parsing — pulls title, pubDate, link, episode number from each <item>
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < MAX_EPISODES) {
      const block = match[1];

      const title = extractTag(block, 'title');
      const pubDate = extractTag(block, 'pubDate');
      const link = extractTag(block, 'link');
      const epNum = extractTag(block, 'itunes:episode');

      if (title) {
        items.push({
          title: cleanText(title),
          pubDate: formatDate(pubDate),
          link: cleanText(link),
          episode: epNum ? cleanText(epNum) : null,
        });
      }
    }

    // Cache for 30 min at the CDN edge, allow stale-while-revalidate for 24h
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    return res.status(200).json({ episodes: items });
  } catch (err) {
    console.error('Feed error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

function extractTag(block, tag) {
  // Handle CDATA-wrapped values and plain values
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`);
  const plainRegex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const cdata = block.match(cdataRegex);
  if (cdata) return cdata[1];
  const plain = block.match(plainRegex);
  if (plain) return plain[1];
  return null;
}

function cleanText(s) {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function formatDate(pubDate) {
  if (!pubDate) return '';
  const d = new Date(pubDate);
  if (isNaN(d.getTime())) return '';
  // "Apr 2026"
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}
