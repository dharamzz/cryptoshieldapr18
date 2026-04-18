// param1.js — Holder Concentration Risk Calculator
// Fully self-contained. Call analyzeHolderConcentration(input) from your UI.

// ─────────────────────────────────────────────
// KNOWN BURN ADDRESSES
// ─────────────────────────────────────────────
const BURN_ADDRESSES = new Set([
  '0x000000000000000000000000000000000000dead',
  '0x0000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000002',
  '0x0000000000000000000000000000000000000003',
  '0x00000000000000000000000000000000000000000', // solana null
  '1nc1nerator11111111111111111111111111111111',   // solana burn
  'TSMcEDDvkqY9DmABmMjnpfWNBNDRQHBEyV',           // tron burn
]);

// ─────────────────────────────────────────────
// KNOWN EXCHANGE WALLETS (top CEXes)
// Source: Etherscan labels + community-verified
// ─────────────────────────────────────────────
const EXCHANGE_WALLETS = new Set([
  // Binance
  '0x28c6c06298d514db089934071355e5743bf21d60',
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d',
  '0x56eddb7aa87536c09ccc2793473599fd21a8b17f',
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549',
  '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8',
  // Coinbase
  '0x503828976d22510aad0201ac7ec88293211d23da',
  '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43',
  '0x71660c4005ba85c37ccec55d0c4493e66fe775d3',
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
  // Solana exchange hot wallets (common ones)
  '5tzFkiKscXHK5ZXCGbCAbLhLLLTXep1RFjMRmSQiX1X',
  'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS',
]);

// ─────────────────────────────────────────────
// CHAIN DETECTION
// ─────────────────────────────────────────────
function detectChain(input) {
  const s = input.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(s))            return { type: 'evm',  raw: s.toLowerCase() };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return { type: 'sol',  raw: s };
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s))   return { type: 'tron', raw: s };
  return { type: 'name', raw: s };
}

// ─────────────────────────────────────────────
// API HELPERS
// ─────────────────────────────────────────────

// Retry on 429
async function fetchWithRetry(url, options = {}, retries = 1) {
  const r = await fetch(url, options);
  if (r.status === 429 && retries > 0) {
    await sleep(2000);
    return fetchWithRetry(url, options, retries - 1);
  }
  return r;
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

// CoinGecko: resolve coin name → { id, platforms }
async function resolveCoinName(name) {
  const r = await fetchWithRetry(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(name)}`
  );
  if (!r.ok) throw new Error('CoinGecko search failed');
  const d = await r.json();
  const coin = d?.coins?.[0];
  if (!coin) return null;

  // Get full coin detail for platforms
  const r2 = await fetchWithRetry(
    `https://api.coingecko.com/api/v3/coins/${coin.id}?localization=false&tickers=false&community_data=false&developer_data=false`
  );
  if (!r2.ok) return { id: coin.id, platforms: {} };
  const d2 = await r2.json();
  return { id: d2.id, name: d2.name, symbol: d2.symbol?.toUpperCase(), platforms: d2.platforms ?? {} };
}

// DexScreener: identify chain from contract address
async function identifyChainViaDexScreener(address) {
  try {
    const r = await fetchWithRetry(`https://api.dexscreener.com/dex/search?q=${address}`);
    if (!r.ok) return null;
    const d = await r.json();
    const pair = d?.pairs?.[0];
    return pair?.chainId ?? null; // e.g. "ethereum", "bsc", "base", "solana"
  } catch { return null; }
}

// Moralis (via proxy): fetch top 50 EVM holders
async function fetchEVMHolders(contractAddress, chain, proxyUrl) {
  const moralisChain = {
    ethereum: 'eth', eth: 'eth', base: 'base', bsc: 'bsc',
    polygon: 'polygon', arbitrum: 'arbitrum', avalanche: 'avalanche',
    optimism: 'optimism',
  }[chain] ?? 'eth';

  const r = await fetchWithRetry(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service: 'moralis-owners',
      params: { address: contractAddress, limit: 50, chain: moralisChain },
    }),
  });
  if (r.status === 429) throw Object.assign(new Error('ratelimit'), { code: 429 });
  if (!r.ok) throw new Error('Moralis unavailable');
  const d = await r.json();
  return d?.result ?? [];
}

// Etherscan-compatible (Etherscan / Basescan / BSCscan / Polygonscan etc)
async function fetchEtherscanHolders(contractAddress, explorerService, proxyUrl) {
  const r = await fetchWithRetry(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service: explorerService,
      params: {
        module: 'token', action: 'tokenholderlist',
        contractaddress: contractAddress, page: 1, offset: 50,
      },
    }),
  });
  if (r.status === 429) throw Object.assign(new Error('ratelimit'), { code: 429 });
  if (!r.ok) throw new Error(`${explorerService} unavailable`);
  const d = await r.json();
  return d?.result ?? [];
}

// Solscan: fetch top 50 SOL holders
async function fetchSolanaHolders(contractAddress) {
  const r = await fetchWithRetry(
    `https://public-api.solscan.io/token/holders?tokenAddress=${contractAddress}&limit=50`
  );
  if (r.status === 429) throw Object.assign(new Error('ratelimit'), { code: 429 });
  if (!r.ok) throw new Error('Solscan unavailable');
  const d = await r.json();
  return d?.data ?? [];
}

// TronScan: fetch top 50 Tron holders
async function fetchTronHolders(contractAddress) {
  const r = await fetchWithRetry(
    `https://apilist.tronscanapi.com/api/token/holders?contract=${contractAddress}&limit=50&start=0`
  );
  if (!r.ok) throw new Error('TronScan unavailable');
  const d = await r.json();
  return d?.data ?? [];
}

// ─────────────────────────────────────────────
// NORMALISE HOLDERS → uniform shape
// { address, balance, pct, txCount }
// ─────────────────────────────────────────────
function normaliseHolders(rawHolders, source) {
  return rawHolders.map(h => {
    const address = (
      h.owner_address ?? h.address ?? h.HolderAddress ?? h.tokenHolder ?? ''
    ).toLowerCase();

    const balance = parseFloat(
      h.balance_formatted ?? h.balance ?? h.TokenHolderQuantity ?? h.amount ?? 0
    );

    const pct = h.percentage != null
      ? parseFloat(h.percentage)
      : null; // will compute later if null

    const txCount = parseInt(h.transaction_count ?? h.txcount ?? 0);

    return { address, balance, pct, txCount };
  }).filter(h => h.address && h.balance >= 0);
}

// ─────────────────────────────────────────────
// HEURISTIC EXCHANGE DETECTION
// If a wallet has very high txCount (>500) it's likely an exchange hot wallet
// ─────────────────────────────────────────────
function isLikelyExchange(holder) {
  return EXCHANGE_WALLETS.has(holder.address) || holder.txCount > 500;
}

function isBurn(holder) {
  return BURN_ADDRESSES.has(holder.address);
}

// ─────────────────────────────────────────────
// CORE CONCENTRATION CALCULATION
// ─────────────────────────────────────────────
function calculateConcentration(holders) {
  // Step 1: Split into categories
  const burnHolders     = holders.filter(h => isBurn(h));
  const exchangeHolders = holders.filter(h => !isBurn(h) && isLikelyExchange(h));
  const normalHolders   = holders.filter(h => !isBurn(h) && !isLikelyExchange(h));

  // Step 2: Compute total supply from all 50 holders
  // (This is an approximation — we only have the top 50, so we use their sum
  //  plus assume holders[0] gives us a % we can cross-reference)
  const totalBalanceInTop50 = holders.reduce((s, h) => s + h.balance, 0);

  // If % is available directly (Moralis provides it), use it to back-calculate total supply
  const hasDirectPct = holders.some(h => h.pct !== null && h.pct > 0);
  let totalSupply = null;
  if (hasDirectPct) {
    const withPct = holders.filter(h => h.pct !== null && h.pct > 0);
    // total_supply = balance / (pct/100)
    const estimates = withPct.map(h => h.balance / (h.pct / 100));
    totalSupply = estimates.reduce((s, v) => s + v, 0) / estimates.length; // average
  }

  // Step 3: Compute burned amount
  const burnedBalance = burnHolders.reduce((s, h) => s + h.balance, 0);
  const burnedPct     = totalSupply ? (burnedBalance / totalSupply) * 100 : 0;

  // Step 4: Circulating supply = total – burned
  const circulatingSupply = totalSupply ? totalSupply - burnedBalance : null;

  // Step 5: Exchange-held %
  const exchangeBalance = exchangeHolders.reduce((s, h) => s + h.balance, 0);
  const exchangePct     = circulatingSupply
    ? (exchangeBalance / circulatingSupply) * 100
    : totalSupply
      ? (exchangeBalance / totalSupply) * 100
      : 0;

  // Step 6: Top 50 normal wallets concentration
  // Use circulating supply as denominator; fall back to top-50 sum if unavailable
  const normalBalance = normalHolders.reduce((s, h) => s + h.balance, 0);
  const denominator   = circulatingSupply ?? totalBalanceInTop50;
  const top50Pct      = denominator > 0 ? (normalBalance / denominator) * 100 : 0;

  // Step 7: Single wallet >10% check
  const whaleWallets = normalHolders.filter(h => {
    const pct = denominator > 0 ? (h.balance / denominator) * 100 : 0;
    return pct > 10;
  }).map(h => ({
    address: h.address,
    pct: denominator > 0 ? ((h.balance / denominator) * 100).toFixed(2) : 'N/A',
  }));

  // Step 8: Base score
  let baseScore;
  if (top50Pct > 50)      baseScore = 3;
  else if (top50Pct >= 30) baseScore = 2;
  else                     baseScore = 1;

  // Step 9: Exchange risk adjustment (cap at 3)
  const exchangePenalty = exchangePct > 40 ? 1 : 0;
  const finalScore      = Math.min(3, baseScore + exchangePenalty);

  return {
    finalScore,
    top50Pct:       top50Pct.toFixed(2),
    exchangePct:    exchangePct.toFixed(2),
    burnedPct:      burnedPct.toFixed(2),
    circulatingSupply: circulatingSupply ? formatSupply(circulatingSupply) : 'Estimated',
    whaleWallets,   // wallets holding >10% — displayed as info, not scored
    holderBreakdown: {
      normal:   normalHolders.length,
      exchange: exchangeHolders.length,
      burn:     burnHolders.length,
    },
    exchangePenaltyApplied: exchangePenalty === 1,
  };
}

function formatSupply(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(0);
}

// ─────────────────────────────────────────────
// CHAIN ROUTER — fetches holders for any supported chain
// ─────────────────────────────────────────────
const EVM_EXPLORER_MAP = {
  ethereum: 'etherscan',
  eth:      'etherscan',
  base:     'basescan',
  bsc:      'bscscan',
  polygon:  'polygonscan',
  arbitrum: 'arbiscan',
  avalanche:'snowtrace',
  optimism: 'optimism',
};

async function fetchHolders(contractAddress, chainId, proxyUrl) {
  // Try Moralis first for all EVM chains (single API covers all)
  if (chainId !== 'sol' && chainId !== 'tron') {
    try {
      const raw = await fetchEVMHolders(contractAddress, chainId, proxyUrl);
      if (raw.length > 0) return { raw, source: 'Moralis' };
    } catch (e) {
      if (e.code === 429) throw e; // propagate rate limit
      // fall through to explorer fallback
    }

    // Fallback: chain-specific block explorer
    const explorerSvc = EVM_EXPLORER_MAP[chainId];
    if (explorerSvc) {
      const raw = await fetchEtherscanHolders(contractAddress, explorerSvc, proxyUrl);
      if (raw.length > 0) return { raw, source: explorerSvc };
    }
  }

  if (chainId === 'sol') {
    const raw = await fetchSolanaHolders(contractAddress);
    return { raw, source: 'Solscan' };
  }

  if (chainId === 'tron') {
    const raw = await fetchTronHolders(contractAddress);
    return { raw, source: 'TronScan' };
  }

  throw new Error('No holder data source available for this chain');
}

// ─────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────

/**
 * analyzeHolderConcentration(input, proxyUrl)
 *
 * input    — coin name (e.g. "BTC") OR contract/token address
 * proxyUrl — your /api/proxy endpoint (keeps API keys server-side)
 *
 * Returns:
 * {
 *   status:       'success' | 'na' | 'error' | 'ratelimit'
 *   reason?:      string (if not success)
 *   score:        1 | 2 | 3 | null
 *   scoreLabel:   'Low' | 'Medium' | 'High' | null
 *   top50Pct:     string   e.g. "43.21"
 *   exchangePct:  string
 *   burnedPct:    string
 *   circulatingSupply: string
 *   whaleWallets: [{ address, pct }]
 *   holderBreakdown: { normal, exchange, burn }
 *   exchangePenaltyApplied: boolean
 *   source:       string  e.g. "Moralis"
 *   chain:        string
 * }
 */
export async function analyzeHolderConcentration(input, proxyUrl = '/api/proxy') {
  if (!input?.trim()) {
    return { status: 'error', reason: 'No input provided', score: null };
  }

  const detected = detectChain(input.trim());
  let contractAddress = null;
  let chainId = null;

  // ── Resolve input ────────────────────────────────────────────────────────

  if (detected.type === 'name') {
    // Coin name → CoinGecko search → find contract + chain
    let coin;
    try {
      coin = await resolveCoinName(detected.raw);
    } catch {
      return { status: 'error', reason: 'CoinGecko search failed', score: null };
    }
    if (!coin) return { status: 'na', reason: 'Coin not found', score: null };

    // Find a supported chain from platforms
    const platformOrder = ['ethereum', 'base', 'binance-smart-chain', 'polygon-pos',
                           'arbitrum-one', 'avalanche', 'optimistic-ethereum', 'solana', 'tron'];
    const chainKeyMap   = {
      'ethereum': 'ethereum', 'base': 'base', 'binance-smart-chain': 'bsc',
      'polygon-pos': 'polygon', 'arbitrum-one': 'arbitrum', 'avalanche': 'avalanche',
      'optimistic-ethereum': 'optimism', 'solana': 'sol', 'tron': 'tron',
    };

    for (const platform of platformOrder) {
      if (coin.platforms?.[platform]) {
        contractAddress = coin.platforms[platform].toLowerCase();
        chainId = chainKeyMap[platform];
        break;
      }
    }

    if (!contractAddress) {
      // BTC or coin with no on-chain contract (e.g. native chain coin)
      return { status: 'na', reason: 'No token contract found — holder data unavailable for native coins like BTC', score: null };
    }

  } else if (detected.type === 'evm') {
    contractAddress = detected.raw;
    // Use DexScreener to identify which EVM chain
    const dexChain = await identifyChainViaDexScreener(contractAddress);
    chainId = dexChain ?? 'ethereum'; // default to ethereum if can't detect

  } else if (detected.type === 'sol') {
    contractAddress = detected.raw;
    chainId = 'sol';

  } else if (detected.type === 'tron') {
    contractAddress = detected.raw;
    chainId = 'tron';
  }

  // ── Fetch holders ────────────────────────────────────────────────────────
  let rawHolders, source;
  try {
    const result = await fetchHolders(contractAddress, chainId, proxyUrl);
    rawHolders = result.raw;
    source     = result.source;
  } catch (e) {
    if (e.code === 429) return { status: 'ratelimit', reason: 'Rate limit hit — please try again in a few seconds', score: null };
    return { status: 'error', reason: e.message || 'Failed to fetch holder data', score: null };
  }

  if (!rawHolders?.length) {
    return { status: 'error', reason: 'No holder data returned from API', score: null };
  }

  // ── Normalise + calculate ────────────────────────────────────────────────
  const holders = normaliseHolders(rawHolders, source);
  const result  = calculateConcentration(holders);

  const scoreLabels = { 1: 'Low', 2: 'Medium', 3: 'High' };

  return {
    status:  'success',
    score:   result.finalScore,
    scoreLabel: scoreLabels[result.finalScore],
    top50Pct:   result.top50Pct,
    exchangePct: result.exchangePct,
    burnedPct:   result.burnedPct,
    circulatingSupply: result.circulatingSupply,
    whaleWallets: result.whaleWallets,
    holderBreakdown: result.holderBreakdown,
    exchangePenaltyApplied: result.exchangePenaltyApplied,
    source,
    chain: chainId,
  };
}
