// src/workers/ingest/helpers.ts

/**
 * Hyperliquid fill structure (simplified)
 */
export interface HLFill {
  time: number;
  coin: string;
  side: string;
  px: string;
  sz: string;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
  feeToken: string;
}

/**
 * Derives a unique fill ID from the fill data.
 * Uses tid (trade id) + hash for uniqueness.
 */
export function deriveFillId(fill: HLFill): string {
  return `${fill.tid}-${fill.hash}`;
}

/**
 * Determines if a fill is a spot trade.
 * Spot coins on Hyperliquid typically have specific naming patterns.
 */
export function isSpot(fill: HLFill): boolean {
  // Spot pairs typically contain "/" or are in the spot market format
  // This may need adjustment based on actual Hyperliquid API responses
  return fill.coin.includes('/') || fill.coin.startsWith('@');
}

/**
 * Determines if a fill is a perpetual trade.
 */
export function isPerp(fill: HLFill): boolean {
  return !isSpot(fill);
}

/**
 * Transposes an array of row arrays into an array of column arrays.
 * Used for PostgreSQL unnest bulk inserts.
 * 
 * Input:  [[a1, b1, c1], [a2, b2, c2], [a3, b3, c3]]
 * Output: [[a1, a2, a3], [b1, b2, b3], [c1, c2, c3]]
 */
export function transpose<T>(rows: T[][]): T[][] {
  if (rows.length === 0) return [];
  
  const numCols = rows[0].length;
  const columns: T[][] = Array.from({ length: numCols }, () => []);
  
  for (const row of rows) {
    for (let i = 0; i < numCols; i++) {
      columns[i].push(row[i]);
    }
  }
  
  return columns;
}

/**
 * Calculates notional USD value for a fill.
 * notional = price * size
 */
export function calculateNotionalUsd(fill: HLFill): number {
  return parseFloat(fill.px) * parseFloat(fill.sz);
}