// Token Radar's model ("radar-2"): one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot can rank: the whole
// watchlist (the floor, never the ceiling) plus every other pre-token protocol
// below the floor that is not an exchange and not a versioned pool of another
// protocol. A protocol is pre-token when its record carries no token at all:
// no market cap, no CoinGecko id, no symbol. Protocols whose token already
// trades are kept apart in the Live view and shown at the market's own value,
// never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   peer     = median(mcap_usd / tvl_usd) of the live-token protocols in the
//              same category (the market's own price for that kind of
//              protocol), shrunk toward the global median so one peer cannot
//              set a whole category: (n x median + 3 x global) / (n + 3);
//              the global median when the category has no live peer;
//              clamped to [0.05, 2.5]
//   base     = tvl_usd x peer
//   growth   = 1 + clamp(change_7d, -50, +100) / 100 x 0.6
//              (a missing 7-day change counts as 0)
//   maturity = 0.7 + 0.3 x (1 - exp(-age_days / 730))
//              age_days from listed_at to the snapshot date; unknown age
//              counts as 365 days. Older with no token is worth more, but
//              the curve saturates: the tenth year adds almost nothing.
//   breadth  = 1 + 0.03 x min(chains - 1, 5), at most 1.15
//   implied  = max(1, round(base x growth x maturity x breadth))
//
// No protocol name is ever special-cased: the same function scores every row,
// and the dashboard's model lab runs this exact arithmetic in the page, so a
// reader can move the constants and watch the board re-rank.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the model lab may move them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_max_chains: number;
  peer_floor: number;
  peer_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 730,
  unknown_age_days: 365,
  breadth_step: 0.03,
  breadth_max_chains: 5,
  peer_floor: 0.05,
  peer_cap: 2.5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 40;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_source: 'category' | 'global';
    growth_pct: number;
    growth_factor: number;
    maturity_factor: number;
    breadth_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** The dashboard's compact view of one board row, with everything the page needs. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  peer_source: 'category' | 'global';
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  peer_global: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol records a token (any of the three token fields is set). */
export function hasToken(p: SnapshotProtocol): boolean {
  return !isPreToken(p);
}

/**
 * Categories whose products are representations of an asset that already
 * trades, not a protocol of their own: a bridge moves an asset that trades
 * elsewhere, a restaked-BTC receipt is the same bitcoin again, and an
 * exchange's own product is the exchange's. The watchlist's rule uses the
 * same exclusions. Liquid staking and liquid restaking stay rankable: those
 * protocols can still issue a governance token of their own, and the name
 * rule below still catches their receipt products ("Staked SOL" and the like).
 */
const REPRESENTATION_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Restaked BTC', 'CEX']);

/** Exchanges whose name at the start of a protocol's name marks it as their own product. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word wrapped, staked or staking in the name marks a receipt product. */
const RECEIPT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol is a wrapped, staked or bridged product of something that already trades. */
export function isRepresentation(p: SnapshotProtocol): boolean {
  if (p.category !== null && REPRESENTATION_CATEGORIES.has(p.category)) return true;
  if (RECEIPT_WORD.test(p.name)) return true;
  for (const exchange of EXCHANGE_NAMES) {
    if (p.name.startsWith(`${exchange} `) || p.name.startsWith(`${exchange}-`)) return true;
  }
  return false;
}

/** Whether a protocol is one the board may rank: pre-token, not a representation, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isRepresentation(p) && !VERSIONED.test(p.name);
}

/**
 * The peer multiple for a category: the median market-cap/TVL of the
 * live-token protocols in that category, shrunk toward the global median so
 * one miscategorised peer cannot set a whole category: with n live peers the
 * multiple is (n x category median + 3 x global median) / (n + 3). Falls
 * back to the global median when the category has no live peer. Both are
 * clamped to the model's peer range.
 */
export function peerMultiples(snapshot: Snapshot, model: ModelConstants): { byCategory: Map<string, number>; global: number } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0 || p.category === 'CEX') continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    // Winsorise: a ratio past 5x is a data quirk (a token with almost no
    // TVL behind it), not a price the market puts on that kind of protocol.
    const winsorised = Math.min(5, Math.max(0.01, ratio));
    all.push(winsorised);
    const list = byCategory.get(p.category ?? '');
    if (list === undefined) byCategory.set(p.category ?? '', [winsorised]);
    else list.push(winsorised);
  }
  const clamp = (v: number): number => Math.min(model.peer_cap, Math.max(model.peer_floor, v));
  const global = all.length > 0 ? clamp(median(all)) : 0.2;
  const out = new Map<string, number>();
  for (const [category, ratios] of byCategory) {
    const shrunk = (ratios.length * median(ratios) + 3 * global) / (ratios.length + 3);
    out.set(category, clamp(shrunk));
  }
  return { byCategory: out, global };
}

/** The factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  peer: number,
  model: ModelConstants,
): { implied: number; growthPct: number; growthFactor: number; maturityFactor: number; breadthFactor: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthFactor = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityFactor =
    model.maturity_floor + model.maturity_range * (1 - Math.exp(-Math.max(ageForModel, 0) / model.maturity_days));
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const breadthFactor = 1 + model.breadth_step * extraChains;
  const base = protocol.tvl_usd * peer;
  const implied = Math.max(1, Math.round(base * growthFactor * maturityFactor * breadthFactor));
  return { implied, growthPct, growthFactor, maturityFactor, breadthFactor, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { byCategory, global } = peerMultiples(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => isRankable(p));
  const scored = chosen.map((p) => {
    const peer = p.category !== null && byCategory.has(p.category)
      ? byCategory.get(p.category)!
      : global;
    const peerSource = p.category !== null && byCategory.has(p.category) ? 'category' : 'global';
    const { implied, growthPct, growthFactor, maturityFactor, breadthFactor, age } = impliedValue(p, snapshot.as_of, peer, model);
    return { p, peer, peerSource, implied, growthPct, growthFactor, maturityFactor, breadthFactor, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: round4(s.peer),
      peer_source: s.peerSource,
      growth_pct: round2(s.growthPct),
      growth_factor: round4(s.growthFactor),
      maturity_factor: round4(s.maturityFactor),
      breadth_factor: round4(s.breadthFactor),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 75;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The category's core farming action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $25 of a stablecoin against it and repay it a week later.`;
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and make one swap through it each week.`;
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then bridge $25 back a week later to show two-way use.`;
  }
  if (c.includes('restak') || c.includes('liquid staking') || c.includes('staking')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and hold the receipt token for the full window.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trad') || c.includes('options')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade, then close it after a day.`;
  }
  if (c.includes('prediction')) {
    return `Fund ${name} with $${capital} and take one small position in a market that settles within the week.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield aggregator') || c.includes('indexes')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares for the full window.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the protocol's own app.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it for the full window.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full window.`;
  }
  if (c.includes('yield')) {
    return `Deposit $${capital} into ${name}'s main yield position on ${chain} and claim the yield once a week.`;
  }
  if (c.includes('card')) {
    return `Order ${name}'s card, fund it with $${capital}, and spend $25 through it each week.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and use its main feature once a week.`;
}

/** A second, different action in the same protocol, so the plan is not one trick repeated. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Borrow a small amount against the supply, swap it on ${chain}, and repay it within the same week.`;
  }
  if (c.includes('dex')) {
    return `Vote on one ${name} governance proposal or pool gauge, if the app offers one, with the position still open.`;
  }
  if (c.includes('bridge')) {
    return `Use the bridged funds in an app on ${chain} instead of bridging them straight back.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Restake or delegate the receipt token through ${name} once, so the wallet shows a second distinct action.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Place one limit order on ${name} and let it fill or expire on its own.`;
  }
  if (c.includes('prediction')) {
    return `Add one comment or one vote in ${name}'s market discussion, if the app offers it.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) {
    return `Move a quarter of the position into a second ${name} vault or strategy on ${chain}.`;
  }
  return `Do one different thing in the ${name} app on ${chain} — a swap, a vote or a second deposit — so the wallet is not a one-action address.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names. Every step is one string of
 * 20 to 600 characters: the action, then what it costs and how long it takes.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 250 ? 8 : 4;
  const steps = [
    `Set up a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot. Cost: under $3 of gas for the first transaction. Time: 5 minutes.`,
    `${actionFor(p, capital, chain)} Cost: $${capital} of capital and about $${gas} of gas. Time: 15 minutes to set up.`,
    `${secondActionFor(p, chain)} Cost: about $2 of gas. Time: 10 minutes.`,
    `Repeat one qualifying action each week — a deposit, a borrow, a swap or a vote — so the wallet stays active across snapshots. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days, so the activity is counted in more than one snapshot instead of one. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Before you withdraw, open the protocol's own points or rewards page from its official site and claim only from the link it publishes. Cost: nothing to check, and never pay anyone to claim for you. Time: 10 minutes.`,
    `Write the wallet, the dates and every transaction in a farm log, so you can repeat the position or unwind it cleanly. Cost: nothing but the log. Time: 5 minutes.`,
  ];
  for (const s of steps) {
    if (s.length < 20 || s.length > 600) throw new Error(`farm step for ${p.slug} is ${s.length} characters`);
  }
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => hasToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const { global } = peerMultiples(snapshot, model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    peer_global: round4(global),
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      peer_multiple: r.model.peer_multiple,
      peer_source: r.model.peer_source,
      growth_factor: r.model.growth_factor,
      maturity_factor: r.model.maturity_factor,
      breadth_factor: r.model.breadth_factor,
      watchlist: watch.has(r.slug),
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board has ${board.length} rows, under the 100 the gate wants`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
    return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
