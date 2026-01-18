// src/workers/ingest/rateLimiter.ts

/**
 * Token Bucket Rate Limiter for HyperLiquid API
 * 
 * HyperLiquid Rate Limits (as of 2025):
 * - REST weight limit: 1200/minute per IP (aggregated)
 * - userFillsByTime weight: 20 base + (items_returned / 20)
 * - Most info endpoints: weight 20
 * - When rate limited: 1 request per 10 seconds allowed
 * 
 * Conservative target: 40 requests/minute = 0.67 requests/second
 * This leaves ~33% headroom for bursts and response-based weights.
 * 
 * DISTRIBUTED MODE:
 * When REDIS_URL is set, rate limiting is coordinated across all workers.
 * Otherwise, falls back to process-local limiting (only safe for single worker).
 */

import { pool } from '@/db/pool';

export interface RateLimiterConfig {
  maxTokens: number;           // Maximum bucket capacity
  refillRate: number;          // Tokens added per second
  tokenCost: number;           // Default cost per request
  useDistributed: boolean;     // Use database-backed distributed limiting
}

export interface RateLimiterStats {
  currentTokens: number;
  maxTokens: number;
  requestsThisMinute: number;
  weightUsedThisMinute: number;
  isRateLimited: boolean;
  nextAvailableAt: Date | null;
  mode: 'local' | 'distributed';
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxTokens: 100,      // Buffer for bursts
  refillRate: 0.67,    // ~40 requests/minute (conservative)
  tokenCost: 20,       // Default weight for userFillsByTime
  useDistributed: true, // Default to distributed mode
};

// ============================================
// Database-backed Distributed Rate Limiter
// ============================================

/**
 * Uses PostgreSQL advisory locks and a simple counter table
 * for distributed rate limiting across multiple workers.
 * 
 * Table schema (add to migrations):
 * CREATE TABLE IF NOT EXISTS public.rate_limit_state (
 *   key TEXT PRIMARY KEY,
 *   tokens NUMERIC NOT NULL,
 *   last_refill TIMESTAMPTZ NOT NULL,
 *   requests_this_minute INT NOT NULL DEFAULT 0,
 *   weight_this_minute INT NOT NULL DEFAULT 0,
 *   minute_start TIMESTAMPTZ NOT NULL,
 *   is_rate_limited BOOLEAN NOT NULL DEFAULT FALSE,
 *   rate_limited_until TIMESTAMPTZ
 * );
 */

const RATE_LIMIT_KEY = 'hyperliquid_global';

async function ensureRateLimitTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.rate_limit_state (
      key TEXT PRIMARY KEY,
      tokens NUMERIC NOT NULL,
      last_refill TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      requests_this_minute INT NOT NULL DEFAULT 0,
      weight_this_minute INT NOT NULL DEFAULT 0,
      minute_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_rate_limited BOOLEAN NOT NULL DEFAULT FALSE,
      rate_limited_until TIMESTAMPTZ
    )
  `);
  
  // Initialize state if not exists
  await pool.query(`
    INSERT INTO public.rate_limit_state (key, tokens, last_refill, minute_start)
    VALUES ($1, $2, NOW(), NOW())
    ON CONFLICT (key) DO NOTHING
  `, [RATE_LIMIT_KEY, DEFAULT_CONFIG.maxTokens]);
}

interface DistributedState {
  tokens: number;
  lastRefill: Date;
  requestsThisMinute: number;
  weightThisMinute: number;
  minuteStart: Date;
  isRateLimited: boolean;
  rateLimitedUntil: Date | null;
}

async function getDistributedState(): Promise<DistributedState> {
  const { rows } = await pool.query<{
    tokens: string;
    last_refill: Date;
    requests_this_minute: number;
    weight_this_minute: number;
    minute_start: Date;
    is_rate_limited: boolean;
    rate_limited_until: Date | null;
  }>(`
    SELECT tokens, last_refill, requests_this_minute, weight_this_minute,
           minute_start, is_rate_limited, rate_limited_until
    FROM public.rate_limit_state
    WHERE key = $1
  `, [RATE_LIMIT_KEY]);
  
  if (rows.length === 0) {
    throw new Error('Rate limit state not initialized');
  }
  
  return {
    tokens: parseFloat(rows[0].tokens),
    lastRefill: rows[0].last_refill,
    requestsThisMinute: rows[0].requests_this_minute,
    weightThisMinute: rows[0].weight_this_minute,
    minuteStart: rows[0].minute_start,
    isRateLimited: rows[0].is_rate_limited,
    rateLimitedUntil: rows[0].rate_limited_until,
  };
}

/**
 * Atomically acquire tokens using PostgreSQL transaction + row lock
 */
async function distributedAcquire(cost: number, config: RateLimiterConfig): Promise<number> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Lock the row for update
    const { rows } = await client.query<{
      tokens: string;
      last_refill: Date;
      requests_this_minute: number;
      weight_this_minute: number;
      minute_start: Date;
      is_rate_limited: boolean;
      rate_limited_until: Date | null;
    }>(`
      SELECT tokens, last_refill, requests_this_minute, weight_this_minute,
             minute_start, is_rate_limited, rate_limited_until
      FROM public.rate_limit_state
      WHERE key = $1
      FOR UPDATE
    `, [RATE_LIMIT_KEY]);
    
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error('Rate limit state not initialized');
    }
    
    const now = new Date();
    let tokens = parseFloat(rows[0].tokens);
    const lastRefill = rows[0].last_refill;
    let requestsThisMinute = rows[0].requests_this_minute;
    let weightThisMinute = rows[0].weight_this_minute;
    let minuteStart = rows[0].minute_start;
    let isRateLimited = rows[0].is_rate_limited;
    const rateLimitedUntil = rows[0].rate_limited_until;
    
    // Check if rate limited
    if (isRateLimited && rateLimitedUntil && now < rateLimitedUntil) {
      const waitTime = rateLimitedUntil.getTime() - now.getTime();
      await client.query('COMMIT');
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return waitTime;
    }
    
    // Clear rate limit if expired
    if (isRateLimited && rateLimitedUntil && now >= rateLimitedUntil) {
      isRateLimited = false;
    }
    
    // Refill tokens based on elapsed time
    const elapsedSeconds = (now.getTime() - lastRefill.getTime()) / 1000;
    tokens = Math.min(config.maxTokens, tokens + elapsedSeconds * config.refillRate);
    
    // Reset minute tracking if needed
    if (now.getTime() - minuteStart.getTime() >= 60000) {
      requestsThisMinute = 0;
      weightThisMinute = 0;
      minuteStart = now;
    }
    
    // Calculate wait time if not enough tokens
    let waitTime = 0;
    if (tokens < cost) {
      const tokensNeeded = cost - tokens;
      waitTime = Math.ceil((tokensNeeded / config.refillRate) * 1000);
    }
    
    // If we need to wait, release lock and wait
    if (waitTime > 0) {
      await client.query('COMMIT');
      await new Promise(resolve => setTimeout(resolve, waitTime));
      // Recursively try again after waiting
      return waitTime + await distributedAcquire(cost, config);
    }
    
    // Deduct tokens and update state
    tokens -= cost;
    requestsThisMinute++;
    weightThisMinute += cost;
    
    await client.query(`
      UPDATE public.rate_limit_state
      SET tokens = $2,
          last_refill = $3,
          requests_this_minute = $4,
          weight_this_minute = $5,
          minute_start = $6,
          is_rate_limited = $7,
          rate_limited_until = NULL
      WHERE key = $1
    `, [RATE_LIMIT_KEY, tokens, now, requestsThisMinute, weightThisMinute, minuteStart, isRateLimited]);
    
    await client.query('COMMIT');
    return 0;
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function distributedMarkRateLimited(): Promise<void> {
  const rateLimitedUntil = new Date(Date.now() + 10000); // 10 second backoff
  
  await pool.query(`
    UPDATE public.rate_limit_state
    SET is_rate_limited = TRUE,
        rate_limited_until = $2,
        tokens = 0
    WHERE key = $1
  `, [RATE_LIMIT_KEY, rateLimitedUntil]);
  
  console.warn('[RateLimiter:Distributed] Hit rate limit, backing off for 10 seconds');
}

async function distributedAdjustForResponse(itemsReturned: number, defaultCost: number): Promise<void> {
  const actualCost = 20 + Math.floor(itemsReturned / 20);
  const costDifference = actualCost - defaultCost;
  
  if (costDifference > 0) {
    await pool.query(`
      UPDATE public.rate_limit_state
      SET tokens = tokens - $2,
          weight_this_minute = weight_this_minute + $2
      WHERE key = $1
    `, [RATE_LIMIT_KEY, costDifference]);
  }
}

async function distributedGetStats(config: RateLimiterConfig): Promise<RateLimiterStats> {
  const state = await getDistributedState();
  
  return {
    currentTokens: Math.floor(state.tokens * 100) / 100,
    maxTokens: config.maxTokens,
    requestsThisMinute: state.requestsThisMinute,
    weightUsedThisMinute: state.weightThisMinute,
    isRateLimited: state.isRateLimited,
    nextAvailableAt: state.rateLimitedUntil,
    mode: 'distributed',
  };
}

async function distributedAvailableRequests(config: RateLimiterConfig): Promise<number> {
  const state = await getDistributedState();
  if (state.isRateLimited) return 0;
  
  // Refill calculation
  const now = Date.now();
  const elapsedSeconds = (now - state.lastRefill.getTime()) / 1000;
  const currentTokens = Math.min(config.maxTokens, state.tokens + elapsedSeconds * config.refillRate);
  
  return Math.floor(currentTokens / config.tokenCost);
}

// ============================================
// Local (In-Process) Rate Limiter
// ============================================

class LocalTokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private config: RateLimiterConfig;
  
  private requestsThisMinute: number = 0;
  private weightUsedThisMinute: number = 0;
  private minuteStartTime: number = Date.now();
  private isRateLimited: boolean = false;
  private rateLimitedUntil: number | null = null;

  constructor(config: RateLimiterConfig) {
    this.config = config;
    this.tokens = config.maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    
    this.tokens = Math.min(
      this.config.maxTokens,
      this.tokens + elapsed * this.config.refillRate
    );
    this.lastRefill = now;

    if (now - this.minuteStartTime >= 60000) {
      this.requestsThisMinute = 0;
      this.weightUsedThisMinute = 0;
      this.minuteStartTime = now;
    }

    if (this.rateLimitedUntil && now >= this.rateLimitedUntil) {
      this.isRateLimited = false;
      this.rateLimitedUntil = null;
    }
  }

  private getWaitTime(cost: number): number {
    this.refill();

    if (this.isRateLimited && this.rateLimitedUntil) {
      return Math.max(0, this.rateLimitedUntil - Date.now());
    }

    if (this.tokens >= cost) {
      return 0;
    }

    const tokensNeeded = cost - this.tokens;
    return Math.ceil((tokensNeeded / this.config.refillRate) * 1000);
  }

  async acquire(cost: number = this.config.tokenCost): Promise<number> {
    const waitTime = this.getWaitTime(cost);

    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.refill();
    }

    this.tokens -= cost;
    this.requestsThisMinute++;
    this.weightUsedThisMinute += cost;

    return waitTime;
  }

  tryAcquire(cost: number = this.config.tokenCost): boolean {
    this.refill();

    if (this.isRateLimited) {
      return false;
    }

    if (this.tokens >= cost) {
      this.tokens -= cost;
      this.requestsThisMinute++;
      this.weightUsedThisMinute += cost;
      return true;
    }

    return false;
  }

  markRateLimited(): void {
    this.isRateLimited = true;
    this.rateLimitedUntil = Date.now() + 10000;
    this.tokens = 0;
    
    console.warn('[RateLimiter:Local] Hit rate limit, backing off for 10 seconds');
  }

  adjustForResponse(itemsReturned: number): void {
    const actualCost = 20 + Math.floor(itemsReturned / 20);
    const costDifference = actualCost - this.config.tokenCost;
    
    if (costDifference > 0) {
      this.tokens -= costDifference;
      this.weightUsedThisMinute += costDifference;
    }
  }

  getStats(): RateLimiterStats {
    this.refill();
    return {
      currentTokens: Math.floor(this.tokens * 100) / 100,
      maxTokens: this.config.maxTokens,
      requestsThisMinute: this.requestsThisMinute,
      weightUsedThisMinute: this.weightUsedThisMinute,
      isRateLimited: this.isRateLimited,
      nextAvailableAt: this.rateLimitedUntil ? new Date(this.rateLimitedUntil) : null,
      mode: 'local',
    };
  }

  availableRequests(cost: number = this.config.tokenCost): number {
    this.refill();
    if (this.isRateLimited) return 0;
    return Math.floor(this.tokens / cost);
  }
}

// ============================================
// Unified Rate Limiter Interface
// ============================================

let localLimiter: LocalTokenBucketRateLimiter | null = null;
let config: RateLimiterConfig = { ...DEFAULT_CONFIG };
let initialized = false;

/**
 * Initialize the rate limiter. Must be called before use if using distributed mode.
 */
export async function initRateLimiter(userConfig?: Partial<RateLimiterConfig>): Promise<void> {
  config = { ...DEFAULT_CONFIG, ...userConfig };
  
  if (config.useDistributed) {
    await ensureRateLimitTable();
    console.log('[RateLimiter] Initialized in distributed mode');
  } else {
    localLimiter = new LocalTokenBucketRateLimiter(config);
    console.log('[RateLimiter] Initialized in local mode (single worker only!)');
  }
  
  initialized = true;
}

function ensureInitialized(): void {
  if (!initialized) {
    // Auto-initialize with local mode for backwards compatibility
    console.warn('[RateLimiter] Auto-initializing in local mode. Call initRateLimiter() for distributed mode.');
    config.useDistributed = false;
    localLimiter = new LocalTokenBucketRateLimiter(config);
    initialized = true;
  }
}

/**
 * Get the rate limiter instance (for backwards compatibility)
 */
export function getRateLimiter(userConfig?: Partial<RateLimiterConfig>): {
  acquire: (cost?: number) => Promise<number>;
  tryAcquire: (cost?: number) => boolean;
  markRateLimited: () => void | Promise<void>;
  adjustForResponse: (itemsReturned: number) => void | Promise<void>;
  getStats: () => RateLimiterStats | Promise<RateLimiterStats>;
  availableRequests: (cost?: number) => number | Promise<number>;
} {
  if (userConfig) {
    config = { ...config, ...userConfig };
  }
  
  ensureInitialized();
  
  if (config.useDistributed) {
    return {
      acquire: (cost = config.tokenCost) => distributedAcquire(cost, config),
      tryAcquire: () => { throw new Error('tryAcquire not supported in distributed mode'); },
      markRateLimited: () => distributedMarkRateLimited(),
      adjustForResponse: (items) => distributedAdjustForResponse(items, config.tokenCost),
      getStats: () => distributedGetStats(config),
      availableRequests: () => distributedAvailableRequests(config),
    };
  }
  
  return localLimiter!;
}

/**
 * Simple acquire function
 */
export async function acquire(cost?: number): Promise<void> {
  ensureInitialized();
  
  if (config.useDistributed) {
    await distributedAcquire(cost ?? config.tokenCost, config);
  } else {
    await localLimiter!.acquire(cost);
  }
}

/**
 * Report that we hit a rate limit
 */
export async function reportRateLimit(): Promise<void> {
  ensureInitialized();
  
  if (config.useDistributed) {
    await distributedMarkRateLimited();
  } else {
    localLimiter!.markRateLimited();
  }
}

/**
 * Adjust for actual response size
 */
export async function adjustForResponseSize(itemCount: number): Promise<void> {
  ensureInitialized();
  
  if (config.useDistributed) {
    await distributedAdjustForResponse(itemCount, config.tokenCost);
  } else {
    localLimiter!.adjustForResponse(itemCount);
  }
}

// Export types and local class for testing
export { LocalTokenBucketRateLimiter };