// api/grab-stream.js
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const config = {
  runtime: 'nodejs', // Ensure Vercel uses Node.js, not Edge runtime
};

export default async function handler(req, res) {
  // CORS Headers (Technique 6 prep)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id, type, season, episode, lang } = req.query;
  if (!id) return res.status(400).json({ error: "Missing 'id' parameter" });

  const isTv = type === 'tv' && season && episode;

  // 10 Providers to iterate through
  const providers = [
    { name: 'VidSrc.me', url: `https://vidsrc.me/embed/${isTv ? 'tv' : 'movie'}?tmdb=${id}${isTv ? `&season=${season}&episode=${episode}` : ''}` },
    { name: 'VidLink.pro', url: `https://vidlink.pro/${isTv ? 'tv' : 'movie'}/${id}${isTv ? `/${season}/${episode}` : ''}${lang === 'hi' ? '?primaryColor=63b8bc&player=jw' : ''}` },
    { name: 'CineSrc.st', url: `https://cinesrc.st/embed/${isTv ? 'tv' : 'movie'}/${id}${lang === 'hi' ? '?lang=hi' : ''}` },
    { name: 'VidCore', url: `https://vidcore.org/embed/${isTv ? 'tv' : 'movie'}/${id}${isTv ? `/${season}/${episode}` : ''}` },
    { name: 'AutoEmbed', url: `https://autoembed.to/api/tmdb/${isTv ? 'tv' : 'movie'}?id=${id}${isTv ? `&s=${season}&e=${episode}` : ''}` },
    { name: 'SuperEmbed', url: `https://superembed.stream/embed/${isTv ? 'tv' : 'movie'}?tmdb=${id}${isTv ? `&s=${season}&e=${episode}` : ''}` },
    { name: '2Embed', url: `https://www.2embed.cc/embed${isTv ? 'tv' : ''}/${id}${isTv ? `&s=${season}&e=${episode}` : ''}` },
    { name: 'Embed.su', url: `https://embed.su/embed/${isTv ? 'tv' : 'movie'}/${id}${isTv ? `/${season}/${episode}` : ''}` },
    { name: 'EmbedWave', url: `https://embedwave.cc/embed/${isTv ? 'tv' : 'movie'}?tmdb=${id}${isTv ? `&season=${season}&episode=${episode}` : ''}` },
    { name: 'MoviesApi', url: `https://moviesapi.club/${isTv ? 'tv' : 'movie'}/${id}${isTv ? `-${season}-${episode}` : ''}` }
  ];

  for (const provider of providers) {
    let browser;
    try {
      console.log(`[Scraper] Attempting: ${provider.name}`);
      
      // Technique 9: Headless Browser Header Forgery (Stealth)
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
      });

      const page = await browser.newPage();
      
      // Technique 9: Spoofing real browser headers to bypass basic Cloudflare
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
        'Origin': 'https://www.google.com',
        'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"'
      });

      let streamUrl = null;

      // Technique 2: Network Request Interception (XHR/Fetch Hooking)
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('.m3u8') || url.includes('.mp4')) {
          // Filter out tiny ad/analytics m3u8 files
          if (url.length > 30 && !url.includes('googlesyndication') && !url.includes('doubleclick') && !url.includes('cloudflare')) {
            streamUrl = url;
          }
        }
        request.continue(); // Must continue to avoid hanging
      });

      // Technique 10: Automated Iframe Redirect Tracing (handled natively by page.goto)
      // Technique 5: Automated DOM Verification
      await page.goto(provider.url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 4000 // Strict 4s timeout per provider to stay under Vercel's 10s limit
      });
      
      // Give it a brief moment for JS to execute and fire the network request
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Technique 5 Fallback: DOM Video Tag Parsing
      if (!streamUrl) {
        try {
          const domSrc = await page.$eval('video source, video', el => el.src);
          if (domSrc && (domSrc.includes('.m3u8') || domSrc.includes('.mp4'))) {
            streamUrl = domSrc;
          }
        } catch (e) { /* No video tag found yet */ }
      }

      // Technique 8: Packed JavaScript / Base64 De-obfuscation
      if (!streamUrl) {
        const html = await page.content();
        const b64Regex = /atob\(['"]([A-Za-z0-9+/=]+)['"]\)/g;
        const matches = [...html.matchAll(b64Regex)];
        for (const match of matches) {
          try {
            const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
            if (decoded.includes('.m3u8') || decoded.includes('.mp4')) {
              const urlMatch = decoded.match(/(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/i) || decoded.match(/(https?:\/\/[^\s"']+\.mp4[^\s"']*)/i);
              if (urlMatch && urlMatch[1].length > 30) {
                streamUrl = urlMatch[1];
                console.log(`[SUCCESS] ✅ Found hidden Base64 stream via ${provider.name}!`);
                break;
              }
            }
          } catch (e) { /* ignore decode errors */ }
        }
      }

      await browser.close();

      if (streamUrl) {
        console.log(`[SUCCESS] 🎯 Found direct stream via ${provider.name}: ${streamUrl}`);
        return res.status(200).json({
          success: true,
          id,
          type: streamUrl.includes('.m3u8') ? 'hls' : 'mp4',
          url: streamUrl,
          provider: provider.name
        });
      }

    } catch (error) {
      console.log(`[FAIL] ${provider.name} failed or timed out:`, error.message);
      if (browser) await browser.close().catch(() => {});
      continue; // Instantly move to the next provider
    }
  }

  // ==========================================
  // FALLBACK: If all 10 providers fail, return safe iframe
  // ==========================================
  console.warn('[Scraper] ❌ All providers failed to yield a direct .m3u8. Falling back to iframe.');
  const fallbackUrl = isTv 
    ? `https://cinesrc.st/embed/tv/${id}${lang === 'hi' ? '?lang=hi' : ''}` 
    : `https://cinesrc.st/embed/movie/${id}${lang === 'hi' ? '?lang=hi' : ''}`;

  return res.status(200).json({
    success: true,
    id,
    type: 'iframe',
    url: fallbackUrl,
    message: "Direct link extraction failed. Using safe iframe fallback."
  });
}
