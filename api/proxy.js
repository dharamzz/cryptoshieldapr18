// api/proxy.js
// Vercel serverless function — never exposes API keys to the browser.
// Frontend calls POST /api/proxy with { service, params } in the body.

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { service, params } = req.body || {};
  if (!service) return res.status(400).json({ error: 'Missing service' });

  // ── API keys (set these in Vercel → Settings → Environment Variables) ─────
  const MORALIS_KEY   = process.env.MORALIS_API_KEY   || '';
  const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || '';
  const BASESCAN_KEY  = process.env.BASESCAN_API_KEY  || '';

  try {
    let url, options = { headers: { 'Content-Type': 'application/json' } };

    // ── Moralis: top ERC-20 holders (ETH, Base, BSC, Polygon, Arbitrum …) ──
    if (service === 'moralis-owners') {
      const { address, limit = 50, chain = 'eth' } = params || {};
      if (!address) return res.status(400).json({ error: 'address required' });
      url = `https://deep-index.moralis.io/api/v2.2/erc20/${address}/owners?limit=${limit}&chain=${chain}`;
      options.headers['X-API-Key'] = MORALIS_KEY;
    }

    // ── Etherscan: token holder list (ETH fallback) ──────────────────────────
    else if (service === 'etherscan') {
      const qs = new URLSearchParams({ ...params, apikey: ETHERSCAN_KEY });
      url = `https://api.etherscan.io/api?${qs}`;
    }

    // ── Basescan: token holder list (BASE chain fallback) ────────────────────
    else if (service === 'basescan') {
      const qs = new URLSearchParams({ ...params, apikey: BASESCAN_KEY });
      url = `https://api.basescan.org/api?${qs}`;
    }

    else {
      return res.status(400).json({ error: `Unknown service: ${service}` });
    }

    // ── Call upstream ─────────────────────────────────────────────────────────
    const upstream = await fetch(url, options);

    if (upstream.status === 429) {
      return res.status(429).json({ error: 'Rate limit — please wait a moment and retry' });
    }
    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).json({ error: `Upstream error ${upstream.status}`, detail: text });
    }

    const data = await upstream.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error('[proxy error]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
