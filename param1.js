// param1.js — Holder Concentration Risk
// Free APIs only: CoinGecko, DexScreener, Solscan (no key needed)
//                 Etherscan (free key), Moralis via proxy (free key)

const PROXY = '/api/proxy';

// ─────────────────────────────────────────────────────────────────────────────
// BURN ADDRESSES
// ─────────────────────────────────────────────────────────────────────────────
const BURN_ADDRESSES = new Set([
  '0x000000000000000000000000000000000000dead',
  '0x0000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000002',
  '0x0000000000000000000000000000000000000003',
  '1nc1nerator11111111111111111111111111111111',
  'tsm6daqmtf4pvhdrbeubwkqpwtwfevmfdbhmk9rk62',
]);

// ─────────────────────────────────────────────────────────────────────────────
// KNOWN EXCHANGE WALLETS
// ─────────────────────────────────────────────────────────────────────────────
const EXCHANGE_WALLETS = new Set([
  '0x28c6c06298d514db089934071355e5743bf21d60',
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d',
  '0x56eddb7aa87536c09ccc2793473599fd21a8b17f',
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549',
  '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8',
  '0xf977814e90da44bfa03b6295a0616a897441acec',
  '0x503828976d22510aad0201ac7ec88293211d23da',
  '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43',
  '0x71660c4005ba85c37ccec55d0c4493e66fe775d3',
  '0x77696bb39917c91a0c3908d577d5e322095425ca',
  '0x2910543af39aba0cd09dbb2d50200b3e800a63d2',
  '0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13',
  '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b',
  '0x236f9f97e0e62388479bf9e5ba4889e46b0273c3',
  '0xf89d7b9c864f589bbf53a82105107622b35eaa40',
  '0x2b5634c42055806a59e9107ed44d43c426e58258',
  '0xa1d8d972560c2f8144af871db508f0b0b10a3fbf',
  '0xab5c66752a9e8167967685f1450532fb96d5d24f',
  '0x6748f50f686bfbca6fe8ad62b22228b87f31ff2b',
  '0x0d0707963952f2fba59dd06f2b425ace40b492fe',
  '0x1151314c646ce4e0efd76d1af4760ae66a9fe30f',
  '0x876eabf441b2ee5b5b0554fd502a8e0600950cfa',
  '0x6262998ced04146fa42253a5c0af90ca02dfd2a3',
  '0xd24400ae8bfebb18ca49be86258a3c749cf46853',
  '0x1f6d66ba924ebf554883cf84d482394013ed294b',
]);

// CoinGecko platform → our chain id
const CG_PLATFORM_MAP = {
  'ethereum':            'eth',
  'base':                'base',
  'binance-smart-chain': 'bsc',
  'polygon-pos':         'polygon',
  'arbitrum-one':        'arbitrum',
  'avalanche':           'avalanche',
  'optimistic-ethereum': 'optimism',
  'solana':              'sol',
};

// Native coins that have NO token contract — handled separately
const NATIVE_COINS = new Set(['bitcoin','btc','ethereum','eth','solana','sol',
  'binancecoin','bnb','ripple','xrp','cardano','ada','dogecoin','doge',
  'polkadot','dot','litecoin','ltc','avalanche-2','avax','tron','trx',
  'monero','xmr','stellar','xlm','cosmos','atom']);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function safeFetch(url, opts = {}, retries = 1) {
  try {
    const r = await fetch(url, opts);
    if (r.status === 429 && retries > 0) {
      await sleep(2500);
      return safeFetch(url, opts, retries - 1);
    }
    return r;
  } catch (e) { throw e; }
}

async function proxyPost(service, params) {
  const r = await fetch(PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service, params }),
  });
  if (r.status === 429) throw Object.assign(new Error('Rate limited'), { code: 429 });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `Proxy error ${r.status}`);
  }
  return r.json();
}

function formatNum(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// INPUT DETECTION
// ─────────────────────────────────────────────────────────────────────────────
export function detectInputType(raw) {
  const s = raw.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(s)) return { type: 'evm_address',  value: s.toLowerCase() };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return { type: 'sol_address', value: s };
  return { type: 'name', value: s };
}

// ─────────────────────────────────────────────────────────────────────────────
// COINGECKO — resolve coin name → metadata + platforms
// ─────────────────────────────────────────────────────────────────────────────
async function resolveCoin(name) {
  const slug = name.toLowerCase().trim();

  // Try direct slug
  try {
    const r = await safeFetch(
      `https://api.coingecko.com/api/v3/coins/${slug}?localization=false&tickers=false&community_data=false&developer_data=false`
    );
    if (r.ok) {
      const d = await r.json();
      return { id: d.id, name: d.name, symbol: d.symbol?.toUpperCase(), platforms: d.platforms ?? {} };
    }
  } catch { /* try search */ }

  // Search
  const r2 = await safeFetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(slug)}`);
  if (!r2.ok) throw new Error('CoinGecko search failed');
  const d2 = await r2.json();
  const coin = d2?.coins?.[0];
  if (!coin) return null;

  // Full detail for platforms
  try {
    const r3 = await safeFetch(
      `https://api.coingecko.com/api/v3/coins/${coin.id}?localization=false&tickers=false&community_data=false&developer_data=false`
    );
    if (r3.ok) {
      const d3 = await r3.json();
      return { id: d3.id, name: d3.name, symbol: d3.symbol?.toUpperCase(), platforms: d3.platforms ?? {} };
    }
  } catch { /* use partial */ }

  return { id: coin.id, name: coin.name, symbol: coin.symbol?.toUpperCase(), platforms: {} };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEXSCREENER — identify which chain an EVM address belongs to (free, no key)
// ─────────────────────────────────────────────────────────────────────────────
async function identifyChain(address) {
  try {
    const r = await safeFetch(`https://api.dexscreener.com/latest/dex/search?q=${address}`);
    if (!r.ok) return null;
    const d = await r.json();
    return d?.pairs?.[0]?.chainId ?? null;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH HOLDERS — tries multiple sources, returns first success
// ─────────────────────────────────────────────────────────────────────────────

// EVM tokens — Moralis (proxy) → Etherscan fallback → Basescan fallback
async function fetchEVMHolders(address, chain) {
  const moralisChain = {
    eth:'eth', ethereum:'eth', base:'base', bsc:'bsc',
    polygon:'polygon', arbitrum:'arbitrum', avalanche:'avalanche', optimism:'optimism',
  }[chain] ?? 'eth';

  // 1. Moralis (best — gives percentage directly)
  try {
    const data = await proxyPost('moralis-owners', { address, limit: 50, chain: moralisChain });
    if (data?.result?.length) return { holders: data.result, source: 'Moralis' };
  } catch (e) {
    if (e.code === 429) throw e;
    console.warn('Moralis failed:', e.message);
  }

  // 2. Etherscan (ETH only)
  if (chain === 'eth' || chain === 'ethereum') {
    try {
      const data = await proxyPost('etherscan', {
        module: 'token', action: 'tokenholderlist',
        contractaddress: address, page: 1, offset: 50,
      });
      if (Array.isArray(data?.result) && data.result.length > 0 && data.result[0].TokenHolderAddress) {
        return { holders: data.result, source: 'Etherscan' };
      }
    } catch (e) { console.warn('Etherscan failed:', e.message); }
  }

  // 3. Basescan (BASE only)
  if (chain === 'base') {
    try {
      const data = await proxyPost('basescan', {
        module: 'token', action: 'tokenholderlist',
        contractaddress: address, page: 1, offset: 50,
      });
      if (Array.isArray(data?.result) && data.result.length > 0) {
        return { holders: data.result, source: 'Basescan' };
      }
    } catch (e) { console.warn('Basescan failed:', e.message); }
  }

  throw new Error('All EVM holder APIs failed. Check your Moralis API key in Vercel environment variables.');
}

// Solana tokens — Solscan (free, no key)
async function fetchSolanaHolders(address) {
  const r = await safeFetch(
    `https://public-api.solscan.io/token/holders?tokenAddress=${address}&limit=50`,
    { headers: { 'User-Agent': 'CryptoShield/1.0' } }
  );
  if (!r.ok) throw new Error(`Solscan error ${r.status}`);
  const d = await r.json();
  const holders = d?.data ?? [];
  if (!holders.length) throw new Error('No Solana holder data returned');
  return { holders, source: 'Solscan' };
}

// ─────────────────────────────────────────────────────────────────────────────
// NATIVE COIN HANDLER
// BTC, ETH (native), SOL (native) — no token contract exists.
// We use CoinGecko market data to give a meaningful score based on
// supply distribution metrics as a proxy.
// ─────────────────────────────────────────────────────────────────────────────
async function handleNativeCoin(coinId, symbol) {
  // Fetch supply data from CoinGecko
  const r = await safeFetch(
    `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`
  );
  if (!r.ok) throw new Error('CoinGecko data unavailable');
  const d = await r.json();

  const circulatingSupply = d?.market_data?.circulating_supply ?? 0;
  const totalSupply       = d?.market_data?.total_supply ?? circulatingSupply;
  const maxSupply         = d?.market_data?.max_supply ?? totalSupply;

  // For native coins we cannot get wallet-level holder data from free APIs.
  // Instead we return a special result explaining this with CoinGecko supply data.
  return {
    status: 'native_coin',
    coinId,
    symbol,
    circulatingSupply: formatNum(circulatingSupply),
    totalSupply: formatNum(totalSupply),
    maxSupply: maxSupply ? formatNum(maxSupply) : '∞',
    note: `${symbol} is a native blockchain coin with no token contract. Wallet-level holder data is not publicly available via free APIs. Supply metrics are shown instead.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// NORMALISE — bring all API responses to uniform shape
// { address, balance, pct, txCount }
// ─────────────────────────────────────────────────────────────────────────────
function normalise(holders) {
  return holders.map(h => {
    // Address field varies by API
    const address = (
      h.owner_address         ??  // Moralis
      h.address               ??  // Solscan
      h.HolderAddress         ??  // Etherscan
      h.TokenHolderAddress    ??  // Etherscan alt
      ''
    ).toLowerCase().trim();

    // Balance field varies by API
    const balance = parseFloat(
      h.balance_formatted     ??  // Moralis (human-readable)
      h.balance               ??  // Solscan / Moralis raw
      h.TokenHolderQuantity   ??  // Etherscan
      h.amount                ??  // Some APIs
      0
    ) || 0;

    // Moralis provides % directly — others don't
    const pct = h.percentage != null ? parseFloat(h.percentage) : null;

    // Transaction count — used for exchange heuristic
    const txCount = parseInt(
      h.transaction_count ?? h.transactions_count ?? h.txcount ?? 0
    );

    return { address, balance, pct, txCount };
  }).filter(h => h.address && h.balance > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFY each wallet
// ─────────────────────────────────────────────────────────────────────────────
function classify(h) {
  if (BURN_ADDRESSES.has(h.address)) return 'burn';
  if (EXCHANGE_WALLETS.has(h.address)) return 'exchange';
  if (h.txCount > 500) return 'exchange'; // heuristic: high-volume = CEX hot wallet
  return 'normal';
}

// ─────────────────────────────────────────────────────────────────────────────
// CALCULATE — steps 4–8
// ─────────────────────────────────────────────────────────────────────────────
function calculate(holders) {
  const tagged = holders.map(h => ({ ...h, tag: classify(h) }));

  const burnHolders     = tagged.filter(h => h.tag === 'burn');
  const exchangeHolders = tagged.filter(h => h.tag === 'exchange');
  const normalHolders   = tagged.filter(h => h.tag === 'normal');

  // Estimate total supply:
  // If Moralis gave us pct directly, back-calculate: totalSupply = balance / (pct/100)
  let totalSupply = null;
  const withPct = tagged.filter(h => h.pct != null && h.pct > 0 && h.balance > 0);
  if (withPct.length >= 3) {
    const estimates = withPct.map(h => h.balance / (h.pct / 100));
    totalSupply = estimates.reduce((a, b) => a + b, 0) / estimates.length;
  }
  // Fallback: use sum of all 50 as denominator (underestimates, but usable)
  if (!totalSupply || totalSupply <= 0) {
    totalSupply = tagged.reduce((s, h) => s + h.balance, 0);
  }

  // Step 4: Circulating supply = total - burned
  const burnedBalance     = burnHolders.reduce((s, h) => s + h.balance, 0);
  const burnedPct         = totalSupply > 0 ? (burnedBalance / totalSupply) * 100 : 0;
  const circulatingSupply = Math.max(totalSupply - burnedBalance, 1);

  // Step 6: Exchange % of circulating supply
  const exchangeBalance = exchangeHolders.reduce((s, h) => s + h.balance, 0);
  const exchangePct     = (exchangeBalance / circulatingSupply) * 100;

  // Step 6: Top 50 normal wallet concentration
  const normalBalance = normalHolders.reduce((s, h) => s + h.balance, 0);
  const top50Pct      = Math.min((normalBalance / circulatingSupply) * 100, 100);

  // Step 6: Single wallet >10% warning
  const whaleWallets = normalHolders
    .map(h => ({ address: h.address, pct: (h.balance / circulatingSupply) * 100 }))
    .filter(h => h.pct > 10)
    .sort((a, b) => b.pct - a.pct)
    .map(h => ({ address: h.address, pct: h.pct.toFixed(2) }));

  // Step 7: Base score
  let baseScore = top50Pct > 50 ? 3 : top50Pct >= 30 ? 2 : 1;

  // Step 8: Exchange penalty, capped at 3
  const exchangePenalty        = exchangePct > 40 ? 1 : 0;
  const finalScore             = Math.min(3, baseScore + exchangePenalty);
  const exchangePenaltyApplied = exchangePenalty === 1;

  return {
    finalScore,
    top50Pct:        top50Pct.toFixed(2),
    exchangePct:     Math.min(exchangePct, 100).toFixed(2),
    burnedPct:       burnedPct.toFixed(2),
    circulatingSupply: formatNum(circulatingSupply),
    whaleWallets,
    exchangePenaltyApplied,
    holderBreakdown: {
      normal:   normalHolders.length,
      exchange: exchangeHolders.length,
      burn:     burnHolders.length,
      total:    tagged.length,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────
export async function analyzeHolderConcentration(input) {
  if (!input?.trim()) return { status: 'error', reason: 'No input provided', score: null };

  const detected = detectInputType(input.trim());
  let contractAddress = null;
  let chain = null;
  let coinMeta = null;

  // ── Step 1: Resolve input ──────────────────────────────────────────────────
  try {
    if (detected.type === 'name') {
      const slug = detected.value.toLowerCase();

      // Check if it's a known native coin BEFORE calling CoinGecko
      if (NATIVE_COINS.has(slug)) {
        const nativeResult = await handleNativeCoin(slug, slug.toUpperCase());
        return nativeResult;
      }

      // Resolve via CoinGecko
      coinMeta = await resolveCoin(slug);
      if (!coinMeta) {
        return { status: 'error', reason: 'Coin not found. Try searching with the full name or paste the contract address directly.', score: null };
      }

      // Check if resolved coin is a native coin
      if (NATIVE_COINS.has(coinMeta.id) || NATIVE_COINS.has(coinMeta.symbol?.toLowerCase())) {
        const nativeResult = await handleNativeCoin(coinMeta.id, coinMeta.symbol);
        nativeResult.coinName = coinMeta.name;
        return nativeResult;
      }

      // Find contract address from supported platforms
      for (const [cgPlatform, ourChain] of Object.entries(CG_PLATFORM_MAP)) {
        if (coinMeta.platforms?.[cgPlatform]) {
          contractAddress = coinMeta.platforms[cgPlatform].toLowerCase();
          chain = ourChain;
          break;
        }
      }

      if (!contractAddress) {
        return {
          status: 'na',
          reason: `${coinMeta.name} (${coinMeta.symbol}) has no supported token contract. It may be a very new coin or on an unsupported chain. Try pasting the contract address directly.`,
          score: null,
        };
      }

    } else if (detected.type === 'evm_address') {
      contractAddress = detected.value;
      // Use DexScreener to detect which EVM chain
      const dexChain = await identifyChain(contractAddress);
      chain = dexChain ?? 'eth'; // default to Ethereum

    } else if (detected.type === 'sol_address') {
      contractAddress = detected.value;
      chain = 'sol';

    } else {
      return { status: 'error', reason: 'Unrecognised input format.', score: null };
    }

  } catch (e) {
    return { status: 'error', reason: 'Failed to resolve coin: ' + e.message, score: null };
  }

  // ── Step 2: Fetch holders ──────────────────────────────────────────────────
  let rawHolders, source;
  try {
    if (chain === 'sol') {
      ({ holders: rawHolders, source } = await fetchSolanaHolders(contractAddress));
    } else {
      ({ holders: rawHolders, source } = await fetchEVMHolders(contractAddress, chain));
    }
  } catch (e) {
    if (e.code === 429) {
      return { status: 'ratelimit', reason: 'API rate limit hit. Please wait a few seconds and try again.', score: null };
    }
    return {
      status: 'error',
      reason: e.message,
      score: null,
      hint: 'Make sure your MORALIS_API_KEY is set in Vercel → Settings → Environment Variables, then redeploy.',
    };
  }

  // ── Steps 3–8: Normalise, classify, calculate ──────────────────────────────
  const holders = normalise(rawHolders);
  if (!holders.length) {
    return { status: 'error', reason: 'API returned empty holder data. Token may be too new or the address may be incorrect.', score: null };
  }

  const result = calculate(holders);
  const LABELS = { 1: 'Low', 2: 'Medium', 3: 'High' };

  return {
    status: 'success',
    score:      result.finalScore,
    scoreLabel: LABELS[result.finalScore],
    top50Pct:   result.top50Pct,
    exchangePct: result.exchangePct,
    burnedPct:   result.burnedPct,
    circulatingSupply: result.circulatingSupply,
    whaleWallets: result.whaleWallets,
    holderBreakdown: result.holderBreakdown,
    exchangePenaltyApplied: result.exchangePenaltyApplied,
    source,
    chain,
    coinName: coinMeta?.name ?? null,
  };
}
