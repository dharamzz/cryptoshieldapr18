export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { service, params } = req.body || {};
  if (!service || !params)     return res.status(400).json({ error: 'Missing service or params' });

  const MORALIS_KEY   = process.env.MORALIS_API_KEY;
  const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;
  const BASESCAN_KEY  = process.env.BASESCAN_API_KEY;

  try {
    let url, headers = { 'Content-Type': 'application/json' };

    // Moralis — ERC20 top holders (works for ETH, Base, BSC, Polygon, Arbitrum, Avalanche)
    if (service === 'moralis-owners') {
      const { address, limit = 50, chain = 'eth' } = params;
      url = `https://deep-index.moralis.io/api/v2.2/erc20/${address}/owners?limit=${limit}&chain=${chain}`;
      headers['X-API-Key'] = MORALIS_KEY;
    }

    // Moralis — wallet history (used for heuristic exchange detection)
    else if (service === 'moralis-history') {
      const { address, limit = 10, order = 'DESC', chain = 'eth' } = params;
      url = `https://deep-index.moralis.io/api/v2.2/wallets/${address}/history?limit=${limit}&order=${order}&chain=${chain}`;
      headers['X-API-Key'] = MORALIS_KEY;
    }

    // Etherscan — token holder list fallback
    else if (service === 'etherscan') {
      const qs = new URLSearchParams({ ...params, apikey: ETHERSCAN_KEY });
      url = `https://api.etherscan.io/api?${qs}`;
    }

    // Basescan — BASE chain holder list fallback
    else if (service === 'basescan') {
      const qs = new URLSearchParams({ ...params, apikey: BASESCAN_KEY });
      url = `https://api.basescan.org/api?${qs}`;
    }

    else {
      return res.status(400).json({ error: `Unknown service: ${service}` });
    }

    const upstream = await fetch(url, { headers });

    if (upstream.status === 429) {
      return res.status(429).json({ error: 'Rate limit — please retry in a few seconds' });
    }
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `API error ${upstream.status}` });
    }

    const data = await upstream.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error('[proxy]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
