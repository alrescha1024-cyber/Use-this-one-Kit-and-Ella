const https = require('https');
const http = require('http');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Search the web using DuckDuckGo HTML lite.
 * No API key needed.
 */
async function webSearch(query, limit = 5) {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

  const html = await fetchRaw(url);
  const results = parseDuckDuckGoResults(html, limit);

  if (results.length === 0) {
    return `No results found for: ${query}`;
  }

  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
    .join('\n\n');
}

/**
 * Fetch a URL and return its text content (HTML stripped).
 */
async function webFetch(url, maxLength = 8000) {
  const html = await fetchRaw(url);
  let text = stripHtml(html);

  // Clean up whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  if (text.length > maxLength) {
    text = text.slice(0, maxLength) + '\n\n[...truncated]';
  }

  return text || 'Could not extract text content from this page.';
}

/**
 * Parse DuckDuckGo HTML lite search results.
 */
function parseDuckDuckGoResults(html, limit) {
  const results = [];

  // Match result blocks: <a class="result__a" href="...">title</a> and snippets
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const links = [];
  let match;
  while ((match = resultRegex.exec(html)) !== null) {
    links.push({ url: decodeURIComponent(match[1]), title: stripHtml(match[2]).trim() });
  }

  const snippets = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(stripHtml(match[1]).trim());
  }

  for (let i = 0; i < Math.min(links.length, limit); i++) {
    // DuckDuckGo wraps URLs in a redirect; extract actual URL
    let url = links[i].url;
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1]);
    }

    results.push({
      title: links[i].title || 'No title',
      url,
      snippet: snippets[i] || '',
    });
  }

  return results;
}

/**
 * Strip HTML tags and decode entities.
 */
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/ \n/g, '\n')
    .trim();
}

/**
 * Low-level HTTP GET, follows redirects.
 */
function fetchRaw(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        },
        timeout: 10000,
      },
      (res) => {
        // Follow redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
          let redirectUrl = res.headers.location;
          if (redirectUrl.startsWith('/')) {
            const parsed = new URL(url);
            redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
          }
          return resolve(fetchRaw(redirectUrl, maxRedirects - 1));
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

module.exports = { webSearch, webFetch };
