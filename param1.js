// param1.js — Holder Concentration Risk (Param 1)
// All free APIs: CoinGecko (no key), DexScreener (no key),
//               Solscan (no key), Moralis via proxy (free tier key needed)
//
// Export: analyzeHolderConcentration(input)
// Returns a result object the UI renders directly.

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const PROXY = '/api/proxy';

// Known burn addresses (all lowercase)
const BURN_ADDRESSES = new Set([
  '0x000000000000000000000000000000000000dead',
  '0x0000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000002',
  '0x0000000000000000000000000000000000000003',
  '1nc1nerator11111111111111111111111111111111',  // Solana burn
  'tsm6daqmtf4pvhdrbeubwkqpwtwfevmfdbhmk9rk62',  // Solana alt burn
]);

// Known CEX hot wallet addresses (all lowercase)
const EXCHANGE_WALLETS = new Set([
  // Binance
  '0x28c6c06298d514db089934071355e5743bf21d60',
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d',
  '0x56eddb7aa87536c09ccc2793473599fd21a8b17f',
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549',
  '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8',
  '0xf977814e90da44bfa03b6295a0616a897441acec',
  // Coinbase
  '0x503828976d22510aad0201ac7ec88293211d23da',
  '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43',
  '0x71660c4005ba85c37ccec55d0c4493e66fe775d3',
  '0x77696bb39917c91a0c3908d577d5e322095425ca',
  // Kraken
  '0x2910543af39aba0cd09dbb2d50200b3e800a63d2',
  '0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13',
  // OKX
  '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b',
  '0x236f9f97e0e62388479bf9e5ba4889e46b0273c3',
  // Bybit
  '0xf89d7b9c864f589bbf53a82105107622b35eaa40',
  // KuCoin
  '0x2b5634c42055806a59e9107ed44d43c426e58258',
  '0xa1d8d972560c2f8144af871db508f0b0b10a3fbf',
  // Huobi / HTX
  '0xab5c66752a9e8167967685f1450532fb96d5d24f',
  '0x6748f50f686bfbca6fe8ad62b22228b87f31ff2b',
  // Gate.io
  '0x0d0707963952f2fba59dd06f2b425ace40b492fe',
  // Bitfinex
  '0x1151314c646ce4e0efd76d1af4760ae66a9fe30f',
  '0x876eabf441b2ee5b5b0554fd502a8e0600950cfa',
  // Crypto.com
  '0x6262998ced04146fa42253a5c0af90ca02dfd2a3',
  // Gemini
  '0xd24400ae8bfebb18ca49be86258a3c749cf46853',
  // Upbit
  '0x1f6d66ba924ebf554883cf84d482394013ed294b',
]);

// CoinGecko platform key → our chain id
const CG_PLATFORM_MAP = {
  'ethereum':          'eth',
  'base':              'base',
  'binance-smart-chain':'bsc',
  'polygon-pos':       'polygon',
  'arbitrum-one':      'arbitrum',
  'avalanche':         'avalanche',
  'optimistic-ethereum':'optimism',
  'solana':            'sol',
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function safeFetch(url, options = {}) {
  try {
    const r = await fetch(url, options);
    if (r.status === 429) {
      await sleep(2000);
      const r2 = await fetch(url, options);
      if (!r2.ok) throw Object.assign(new Error('rate_limit'), { code: 429 });
      return r2;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  } catch (e) { throw e; }
}

async function proxyPost(service, params) {
  const r = await fetch(PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service, params }),
  });
  if (r.status === 429) throw Object.assign(new Error('rate_limit'), { code: 429 });
  if (!r.ok) throw new Error(`Proxy error ${r.status}`);
  return r.json();
}

function formatNumber(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — INPUT DETECTION
// ─────────────────────────────────────────────────────────────────────────────

export function detectInputType(raw) {
  const s = raw.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(s)) return { type: 'evm_address', value: s.toLowerCase() };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return { type: 'sol_address', value: s };
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s))   return { type: 'trx_address', value: s };
  if (s.length >= 1 && s.length <= 60)           return { type: 'name', value: s };
  return { type: 'invalid' };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1b — RESOLVE COIN NAME → contract + chain via CoinGecko (free, no key)
// ─────────────────────────────────────────────────────────────────────────────

async function resolveCoinByName(name) {
  // Direct slug attempt first (fast path for BTC, ETH, etc.)
  try {
    const r = await safeFetch(
      `https://api.coingecko.com/api/v3/coins/${name.toLowerCase()}?localization=false&tickers=false&community_data=false&developer_data=false`
    );
    const d = await r.json();
    return { id: d.id, name: d.name, symbol: d.symbol?.toUpperCase(), platforms: d.platforms ?? {} };
  } catch { /* try search */ }

  // Search endpoint
  const r2 = await safeFetch(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(name)}`
  );
  const d2 = await r2.json();
  const coin = d2?.coins?.[0];
  if (!coin) return null;

  // Fetch full detail for platform addresses
  try {
    const r3 = await safeFetch(
      `https://api.coingecko.com/api/v3/coins/${coin.id}?localization=false&tickers=false&community_data=false&developer_data=false`
    );
    const d3 = await r3.json();
    return { id: d3.id, name: d3.name, symbol: d3.symbol?.toUpperCase(), platforms: d3.platforms ?? {} };
  } catch {
    return { id: coin.id, name: coin.name, symbol: coin.symbol?.toUpperCase(), platforms: {} };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1c — IDENTIFY WHICH EVM CHAIN via DexScreener (free, no key)
// ─────────────────────────────────────────────────────────────────────────────

async function identifyEvmChain(address) {
  try {
    const r = await safeFetch(`https://api.dexscreener.com/dex/search?q=${address}`);
    const d = await r.json();
    // DexScreener returns chainId like "ethereum", "base", "bsc", "polygon" etc.
    return d?.pairs?.[0]?.chainId ?? null;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — FETCH TOP 50 HOLDERS
// ─────────────────────────────────────────────────────────────────────────────

// EVM chains → Moralis (via proxy) with Etherscan/Basescan fallback
async function fetchEVMHolders(address, chain) {
  // Moralis chain param mapping
  const moralisChain = {
    eth: 'eth', ethereum: 'eth',
    base: 'base',
    bsc: 'bsc',
    polygon: 'polygon',
    arbitrum: 'arbitrum',
    avalanche: 'avalanche',
    optimism: 'optimism',
  }[chain] ?? 'eth';

  // Try Moralis first
  try {
    const data = await proxyPost('moralis-owners', { address, limit: 50, chain: moralisChain });
    if (data?.result?.length) return { holders: data.result, source: 'Moralis' };
  } catch (e) {
    if (e.code === 429) throw e; // propagate rate limit
  }

  // Fallback: Etherscan for ETH, Basescan for Base
  if (chain === 'eth' || chain === 'ethereum') {
    try {
      const data = await proxyPost('etherscan', {
        module: 'token', action: 'tokenholderlist',
        contractaddress: address, page: 1, offset: 50,
      });
      if (Array.isArray(data?.result) && data.result.length) {
        return { holders: data.result, source: 'Etherscan' };
      }
    } catch { /* fall through */ }
  }

  if (chain === 'base') {
    try {
      const data = await proxyPost('basescan', {
        module: 'token', action: 'tokenholderlist',
        contractaddress: address, page: 1, offset: 50,
      });
      if (Array.isArray(data?.result) && data.result.length) {
        return { holders: data.result, source: 'Basescan' };
      }
    } catch { /* fall through */ }
  }

  throw new Error('No holder data available for this EVM token');
}

// Solana → Solscan (free, no key)
async function fetchSolanaHolders(address) {
  const r = await safeFetch(
    `https://public-api.solscan.io/token/holders?tokenAddress=${address}&limit=50`
  );
  const d = await r.json();
  return { holders: d?.data ?? [], source: 'Solscan' };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — NORMALISE HOLDERS → uniform shape
// { address, balance, pct, txCount }
// ─────────────────────────────────────────────────────────────────────────────

function normalise(holders) {
  return holders.map(h => {
    const address = (
      h.owner_address ?? h.address ?? h.HolderAddress ?? h.tokenHolder ?? ''
    ).toLowerCase().trim();

    const balance = parseFloat(
      h.balance_formatted ?? h.balance ?? h.TokenHolderQuantity ?? h.amount ?? 0
    ) || 0;

    // Moralis provides percentage directly; others don't
    const pct = h.percentage != null ? parseFloat(h.percentage) : null;

    // Heuristic: high tx count = likely exchange
    const txCount = parseInt(h.transaction_count ?? h.transactions_count ?? h.txcount ?? 0);

    return { address, balance, pct, txCount };
  }).filter(h => h.address && h.balance > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEPS 3–8 — CLASSIFY, FILTER, CALCULATE, SCORE
// ─────────────────────────────────────────────────────────────────────────────

function classify(holder) {
  if (BURN_ADDRESSES.has(holder.address)) return 'burn';
  if (EXCHANGE_WALLETS.has(holder.address)) return 'exchange';
  // Heuristic: wallets with >500 transactions are likely exchange hot wallets
  if (holder.txCount > 500) return 'exchange';
  return 'normal';
}

function calculate(holders) {
  // Tag each holder
  const tagged = holders.map(h => ({ ...h, tag: classify(h) }));

  const burnHolders     = tagged.filter(h => h.tag === 'burn');
  const exchangeHolders = tagged.filter(h => h.tag === 'exchange');
  const normalHolders   = tagged.filter(h => h.tag === 'normal');

  // ── Estimate total supply ────────────────────────────────────────────────
  // If Moralis gave us pct, back-calculate: totalSupply ≈ balance / (pct/100)
  let totalSupply = null;
  const withPct = tagged.filter(h => h.pct !== null && h.pct > 0 && h.balance > 0);
  if (withPct.length > 0) {
    const estimates = withPct.map(h => h.balance / (h.pct / 100));
    totalSupply = estimates.reduce((s, v) => s + v, 0) / estimates.length;
  }

  // Fallback: sum of all 50 holders (underestimates total supply, but usable)
  const top50Sum = tagged.reduce((s, h) => s + h.balance, 0);
  if (!totalSupply) totalSupply = top50Sum;

  // ── Step 4: Burned + circulating supply ──────────────────────────────────
  const burnedBalance    = burnHolders.reduce((s, h) => s + h.balance, 0);
  const burnedPct        = totalSupply > 0 ? (burnedBalance / totalSupply) * 100 : 0;
  const circulatingSupply = Math.max(totalSupply - burnedBalance, 1);

  // ── Step 6: Exchange-held % (of circulating supply) ──────────────────────
  const exchangeBalance  = exchangeHolders.reduce((s, h) => s + h.balance, 0);
  const exchangePct      = (exchangeBalance / circulatingSupply) * 100;

  // ── Step 6: Top 50 normal wallet concentration % ─────────────────────────
  const normalBalance    = normalHolders.reduce((s, h) => s + h.balance, 0);
  const top50Pct         = (normalBalance / circulatingSupply) * 100;

  // ── Step 6: Single wallet >10% warning ───────────────────────────────────
  const whaleWallets = normalHolders
    .map(h => ({ address: h.address, pct: (h.balance / circulatingSupply) * 100 }))
    .filter(h => h.pct > 10)
    .map(h => ({ address: h.address, pct: h.pct.toFixed(2) }));

  // ── Step 7: Base score ────────────────────────────────────────────────────
  let baseScore;
  if (top50Pct > 50)      baseScore = 3; // High
  else if (top50Pct >= 30) baseScore = 2; // Medium
  else                     baseScore = 1; // Low

  // ── Step 8: Exchange penalty (cap at 3) ───────────────────────────────────
  const exchangePenalty        = exchangePct > 40 ? 1 : 0;
  const finalScore             = Math.min(3, baseScore + exchangePenalty);
  const exchangePenaltyApplied = exchangePenalty === 1;

  return {
    finalScore,
    top50Pct:       Math.min(top50Pct, 100).toFixed(2),
    exchangePct:    Math.min(exchangePct, 100).toFixed(2),
    burnedPct:      burnedPct.toFixed(2),
    circulatingSupply: formatNumber(circulatingSupply),
    whaleWallets,
    exchangePenaltyApplied,
    holderBreakdown: {
      normal:   normalHolders.length,
      exchange: exchangeHolders.length,
      burn:     burnHolders.length,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * analyzeHolderConcentration(input)
 *
 * input — coin name (e.g. "BTC", "Uniswap") OR contract/token address
 *
 * Returns {
 *   status:      'success' | 'na' | 'error' | 'ratelimit'
 *   reason?:     string          — shown when status !== success
 *   score:       1 | 2 | 3 | null
 *   scoreLabel:  'Low' | 'Medium' | 'High' | null
 *   top50Pct:    string          — e.g. "43.21"
 *   exchangePct: string
 *   burnedPct:   string
 *   circulatingSupply: string
 *   whaleWallets: [{ address, pct }]
 *   holderBreakdown: { normal, exchange, burn }
 *   exchangePenaltyApplied: boolean
 *   source:      string          — which API provided the data
 *   chain:       string          — detected chain
 *   coinName?:   string
 * }
 */
export async function analyzeHolderConcentration(input) {
  if (!input?.trim()) return { status: 'error', reason: 'No input provided', score: null };

  const detected = detectInputType(input.trim());
  if (detected.type === 'invalid') return { status: 'error', reason: 'Invalid input format', score: null };

  let contractAddress = null;
  let chain = null;
  let coinName = null;

  // ── Resolve input ──────────────────────────────────────────────────────────
  try {
    if (detected.type === 'name') {
      // Coin name → CoinGecko search
      const coin = await resolveCoinByName(detected.value);
      if (!coin) return { status: 'na', reason: 'Coin not found. Try pasting the contract address directly.', score: null };

      coinName = coin.name;

      // Find contract address from supported platforms
      for (const [cgPlatform, ourChain] of Object.entries(CG_PLATFORM_MAP)) {
        if (coin.platforms?.[cgPlatform]) {
          contractAddress = coin.platforms[cgPlatform].toLowerCase();
          chain = ourChain;
          break;
        }
      }

      if (!contractAddress) {
        return {
          status: 'na',
          reason: `${coin.name} (${coin.symbol}) has no token contract — it is likely a native chain coin like BTC. Holder concentration data is not available.`,
          score: null,
        };
      }

    } else if (detected.type === 'evm_address') {
      contractAddress = detected.value;
      // Use DexScreener to identify which EVM chain this contract is on
      const dexChain = await identifyEvmChain(contractAddress);
      chain = dexChain ?? 'eth'; // default to Ethereum if detection fails

    } else if (detected.type === 'sol_address') {
      contractAddress = detected.value;
      chain = 'sol';

    } else if (detected.type === 'trx_address') {
      return { status: 'na', reason: 'Tron (TRX) chain holder data not yet supported.', score: null };
    }

  } catch (e) {
    return { status: 'error', reason: 'Failed to resolve coin: ' + e.message, score: null };
  }

  // ── Fetch holders ──────────────────────────────────────────────────────────
  let rawHolders, source;
  try {
    if (chain === 'sol') {
      ({ holders: rawHolders, source } = await fetchSolanaHolders(contractAddress));
    } else {
      ({ holders: rawHolders, source } = await fetchEVMHolders(contractAddress, chain));
    }
  } catch (e) {
    if (e.code === 429) return { status: 'ratelimit', reason: 'API rate limit hit. Please wait a few seconds and try again.', score: null };
    return { status: 'error', reason: e.message || 'Failed to fetch holder data', score: null };
  }

  if (!rawHolders?.length) {
    return { status: 'error', reason: 'No holder data returned from API. The token may be very new or the API may be temporarily unavailable.', score: null };
  }

  // ── Normalise + calculate ──────────────────────────────────────────────────
  const holders = normalise(rawHolders);
  if (!holders.length) {
    return { status: 'error', reason: 'Could not parse holder data from API response.', score: null };
  }

  const result = calculate(holders);
  const scoreLabels = { 1: 'Low', 2: 'Medium', 3: 'High' };

  return {
    status: 'success',
    score:      result.finalScore,
    scoreLabel: scoreLabels[result.finalScore],
    top50Pct:   result.top50Pct,
    exchangePct: result.exchangePct,
    burnedPct:   result.burnedPct,
    circulatingSupply: result.circulatingSupply,
    whaleWallets: result.whaleWallets,
    holderBreakdown: result.holderBreakdown,
    exchangePenaltyApplied: result.exchangePenaltyApplied,
    source,
    chain,
    coinName,
  };
}
