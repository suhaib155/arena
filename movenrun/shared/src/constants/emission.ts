// Base emission: 10 $MOVE per km (in wei, 18 decimals)
export const BASE_RATE = BigInt("10000000000000000000");

// Halving every ~6 months on Base (~2.6M blocks at 2s block time)
export const HALVING_INTERVAL = 2_600_000n;

// Starting daily cap: 200 $MOVE per address (in wei)
export const DAILY_CAP_INITIAL = BigInt("200000000000000000000");

// Total supply: 1 billion $MOVE (in wei)
export const TOTAL_SUPPLY = BigInt("1000000000000000000000000000");

// Zone tax: 2% of all $MOVE minted in a hex goes to zone NFT owner
export const ZONE_TAX_BPS = 200n; // basis points

// Auto-valve: if weeklyBurn/weeklyMint < this ratio, reduce baseRate 10%
export const MIN_BURN_MINT_RATIO = 0.7;

// Emission schedule (per km, in $MOVE):
// Epoch 0: 10 $MOVE/km
// Epoch 1: 7 $MOVE/km
// Epoch 2: 4.9 $MOVE/km
// Epoch 3: 3.43 $MOVE/km
// Formula: BASE_RATE * 0.7^epoch

export const CHALLENGE_DECLARATION_COST = BigInt("100000000000000000000"); // 100 $MOVE
export const STRONGHOLD_BOOST_COST = BigInt("300000000000000000000");      // 300 $MOVE
export const TIME_EXTENSION_COST = BigInt("500000000000000000000");         // 500 $MOVE
export const CHALLENGE_DURATION_DAYS = 14;
export const TIME_EXTENSION_DAYS = 3;
