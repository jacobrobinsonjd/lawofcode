// /api/episodes.js
// Fetches the Law of Code RSS feed, parses it, returns latest episodes as JSON.
// Cached for 30 minutes via Cache-Control header so Vercel's edge serves it fast.

const FEED_URL = 'https://anchor.fm/s/5e2873d8/podcast/rss';
const MAX_EPISODES = 15;
const FETCH_TIMEOUT_MS = 8000;

export default async function handler(req, res) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const feedRes = await fetch(FEED_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; lawofcode.fm/1.0; +https://lawofcode.fm)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    if (!feedRes.ok) {
      return res.status(502).json({
        error: 'Feed fetch failed',
        status: feedRes.status,
        statusText: feedRes.statusText,
      });
    }

    const xml = await feedRes.text();

    if (!xml || xml.length < 100) {
      return res.status(502).json({ error: 'Empty feed response', size: xml.length });
    }

    const items = [];
    const itemRegex = /<item[\s>][\s\S]*?<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < MAX_EPISODES) {
      const block = match[0];
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

    if (items.length === 0) {
      return res.status(502).json({
        error: 'No items parsed from feed',
        xmlSize: xml.length,
        xmlStart: xml.slice(0, 200),
      });
    }

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    return res.status(200).json({ episodes: items });
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err && err.name === 'AbortError';
    return res.status(500).json({
      error: isAbort ? 'Feed request timed out' : 'Server error',
      message: err && err.message ? err.message : String(err),
    });
  }
}

function extractTag(block, tag) {
  const cdataRegex = new RegExp('<' + tag + '[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/' + tag + '>');
  const plainRegex = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>');
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
    .replace(/&apos;/g, "'")
    .trim();
}

function formatDate(pubDate) {
  if (!pubDate) return '';
  const d = new Date(cleanText(pubDate));
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}
