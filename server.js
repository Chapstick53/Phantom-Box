// server.js
// Polite scrape proxy for sms24.me (best-effort)
// Run: npm init -y
// npm i express node-fetch@2 cheerio cors express-rate-limit

const express = require('express');
const fetch = require('node-fetch'); // v2 API
const cheerio = require('cheerio');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(cors());
app.use(express.json());

// Rate-limit inbound requests to our proxy (protect both us and target)
app.use(rateLimit({
  windowMs: 10_000, // 10s window
  max: 25,
  message: { error: 'Too many requests, slow down.' }
}));

// Basic in-memory cache and reservation store
const CACHE_TTL = 30_000; // 30s cache
const cache = new Map(); // key -> { ts, data }
const reserved = {};     // phone -> reservedAt (ms)
const RESERVE_MS = 60_000; // 60s local reservation

function setCache(key, data) {
  cache.set(key, { ts: Date.now(), data });
}
function getCache(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > CACHE_TTL) { cache.delete(key); return null; }
  return v.data;
}

// polite fetch with timeout & UA
async function politeFetch(url, opts = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PhantomBox-scraper/1.0 (+you@yourdomain)', ...(opts.headers||{}) },
      signal: controller.signal,
      ...opts
    });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// Helper: normalize phone string (very basic)
function normalizePhone(s) {
  if (!s) return s;
  return s.replace(/\s+/g, '').replace(/\(|\)|-/g, '');
}

/**
 * GET /api/numbers
 * Scrape sms24.me (main number listing) and return array of numbers (best-effort).
 */
app.get('/api/numbers', async (req, res) => {
  try {
    const cached = getCache('numbers');
    if (cached) return res.json({ numbers: cached });

    const url = 'https://sms24.me/en/numbers';
    const r = await politeFetch(url);
    if (!r.ok) return res.status(502).json({ error: 'upstream_fetch_failed', status: r.status });

    const html = await r.text();
    const $ = cheerio.load(html);

    const nums = new Set();
    // best-effort selectors: many public temp-number sites use anchors containing number text
    $('a,div,span').each((i, el) => {
      const txt = $(el).text().trim();
      const m = txt.match(/(\+\d[\d\s\-\(\)]{5,}\d)/);
      if (m) nums.add(normalizePhone(m[1]));
    });

    // Some pages include data-phone attributes or JSON; try extracting common patterns
    $('[data-phone]').each((i, el) => nums.add(normalizePhone($(el).attr('data-phone'))));

    const arr = Array.from(nums).filter(Boolean).slice(0, 60);
    setCache('numbers', arr);
    res.json({ numbers: arr });
  } catch (e) {
    console.error('numbers scrape error', e);
    res.status(500).json({ error: 'scrape_failed', message: e.message });
  }
});

/**
 * GET /api/messages?phone=<phone>
 * Scrape the message listing page for a phone number and return messages as JSON.
 */
app.get('/api/messages', async (req, res) => {
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ error: 'missing phone param' });
  const norm = normalizePhone(phone);

  try {
    const cacheKey = `messages:${norm}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json({ messages: cached });

    // Build candidate page URL(s) to try:
    // sms24 tends to form number-specific pages under /en/numbers/COUNTRY/SLUG or similar.
    // We'll try a heuristic: search listing page for a link that contains the number.
    const listUrl = 'https://sms24.me/en/numbers';
    const listRes = await politeFetch(listUrl);
    if (!listRes.ok) return res.status(502).json({ error: 'upstream_list_fetch_failed', status: listRes.status });
    const listHtml = await listRes.text();
    const $list = cheerio.load(listHtml);

    // find links containing the number text
    let candidateHref = null;
    $list('a').each((i, el) => {
      const href = $list(el).attr('href') || '';
      const txt = $list(el).text() || '';
      if (href.includes(norm) || txt.includes(norm)) {
        candidateHref = href;
        return false;
      }
    });

    // fallback: construct naive path
    let pageUrl;
    if (candidateHref) {
      pageUrl = candidateHref.startsWith('http') ? candidateHref : ('https://sms24.me' + (candidateHref.startsWith('/') ? '' : '/') + candidateHref);
    } else {
      // try a direct guess (may not always work)
      pageUrl = `https://sms24.me/en/numbers/${encodeURIComponent(norm)}`;
    }

    const pageRes = await politeFetch(pageUrl);
    if (!pageRes.ok) {
      // last fallback: try direct number slug (without /en/)
      const alt = `https://sms24.me/${encodeURIComponent(norm)}`;
      const r2 = await politeFetch(alt);
      if (!r2.ok) {
        return res.status(502).json({ error: 'upstream_page_failed', tried: [pageUrl, alt], status: pageRes.status });
      } else {
        // use r2
        const html2 = await r2.text();
        const msgs = parseMessagesFromHtml(html2);
        setCache(cacheKey, msgs);
        return res.json({ messages: msgs });
      }
    }

    const html = await pageRes.text();
    const messages = parseMessagesFromHtml(html);
    setCache(cacheKey, messages);
    res.json({ messages });
  } catch (e) {
    console.error('messages error', e);
    res.status(500).json({ error: 'scrape_failed', message: e.message });
  }
});

// Parses messages from a provider HTML (best-effort)
function parseMessagesFromHtml(html) {
  const $ = cheerio.load(html);
  const msgs = [];

  // Try common SMS-list selectors; site DOMs vary, so be permissive
  // Common: each SMS in .msg, .inbox-row, .sms, .panel-body, etc.
  const probableContainers = ['.sms-item', '.inbox-item', '.sms', '.message', '.media-body', '.panel-body', '.card-body', '.list-group-item'];

  // First pass: look for elements that look like individual messages
  let found = 0;
  probableContainers.forEach(sel => {
    $(sel).each((i, el) => {
      const from = $(el).find('.from, .name, .sender').first().text().trim() || '';
      const date = $(el).find('.date, .time, .created').first().text().trim() || '';
      const body = $(el).find('.body, .msg, p, .text, .message-text').first().text().trim() || $(el).text().trim();
      if (body && body.length > 3) {
        msgs.push({ id: `m-${found++}-${i}`, from: from || 'unknown', body: body, date: date || new Date().toISOString() });
      }
    });
  });

  // Fallback: find elements that contain "From:" or typical patterns
  if (msgs.length === 0) {
    $('p,div,span,pre').each((i, el) => {
      const txt = $(el).text().trim();
      if (!txt) return;
      // skip short nav text
      if (txt.length < 20) return;
      // Heuristic: likely message if contains digits or words like 'code' or 'OTP'
      if (/OTP|code|verification|from|:|\d{4,}/i.test(txt)) {
        msgs.push({ id: `fb-${i}`, from: 'unknown', body: txt, date: new Date().toISOString() });
      }
    });
  }

  // Limit and return newest-first
  return msgs.slice(0, 40);
}

/**
 * GET /api/reserve?phone=<phone>
 * Local in-memory reservation (non-binding). Useful to show 'reserved' number in UI.
 */
app.get('/api/reserve', (req, res) => {
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ error: 'missing phone' });
  const p = normalizePhone(phone);
  if (reserved[p] && (Date.now() - reserved[p]) < RESERVE_MS) {
    return res.json({ reserved: true, phone: p, expiresIn: RESERVE_MS - (Date.now() - reserved[p]) });
  }
  reserved[p] = Date.now();
  res.json({ reserved: true, phone: p, expiresIn: RESERVE_MS });
});

// Simple health
app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log('sms24 scrape-proxy listening on', PORT));
