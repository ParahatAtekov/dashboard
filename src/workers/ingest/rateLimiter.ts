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
 */

export interface RateLimiterConfig {
  maxTokens: number;           // Maximum bucket capacity
  refillRate: number;          // Tokens added per second
  tokenCost: number;           // Default cost per request
}

export interface RateLimiterStats {
  currentTokens: number;
  maxTokens: number;
  requestsThisMinute: number;
  weightUsedThisMinute: number;
  isRateLimited: boolean;
  nextAvailableAt: Date | null;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxTokens: 100,      // Buffer for bursts
  refillRate: 0.67,    // ~40 requests/minute (conservative)
  tokenCost: 20,       // Default weight for userFillsByTime
};

class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private config: RateLimiterConfig;
  
  // Tracking for observability
  private requestsThisMinute: number = 0;
  private weightUsedThisMinute: number = 0;
  private minuteStartTime: number = Date.now();
  private isRateLimited: boolean = false;
  private rateLimitedUntil: number | null = null;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tokens = this.config.maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // seconds
    
    this.tokens = Math.min(
      this.config.maxTokens,
      this.tokens + elapsed * this.config.refillRate
    );
    this.lastRefill = now;

    // Reset minute tracking
    if (now - this.minuteStartTime >= 60000) {
      this.requestsThisMinute = 0;
      this.weightUsedThisMinute = 0;
      this.minuteStartTime = now;
    }

    // Clear rate limit if time has passed
    if (this.rateLimitedUntil && now >= this.rateLimitedUntil) {
      this.isRateLimited = false;
      this.rateLimitedUntil = null;
    }
  }

  /**
   * Calculate wait time until enough tokens are available
   */
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

  /**
   * Acquire tokens for a request. Waits if necessary.
   * Returns the actual wait time in ms.
   */
  async acquire(cost: number = this.config.tokenCost): Promise<number> {
    const waitTime = this.getWaitTime(cost);

    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.refill(); // Refill after waiting
    }

    this.tokens -= cost;
    this.requestsThisMinute++;
    this.weightUsedThisMinute += cost;

    return waitTime;
  }

  /**
   * Try to acquire without waiting. Returns false if not enough tokens.
   */
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

  /**
   * Called when HyperLiquid returns a rate limit error.
   * Backs off for 10 seconds (HL allows 1 req/10s when limited).
   */
  markRateLimited(): void {
    this.isRateLimited = true;
    this.rateLimitedUntil = Date.now() + 10000; // 10 second backoff
    this.tokens = 0; // Drain the bucket
    
    console.warn('[RateLimiter] Hit rate limit, backing off for 10 seconds');
  }

  /**
   * Adjust token cost based on response size.
   * userFillsByTime: weight = 20 + floor(items_returned / 20)
   */
  adjustForResponse(itemsReturned: number): void {
    const actualCost = 20 + Math.floor(itemsReturned / 20);
    const costDifference = actualCost - this.config.tokenCost;
    
    if (costDifference > 0) {
      // We underestimated, deduct the difference
      this.tokens -= costDifference;
      this.weightUsedThisMinute += costDifference;
    }
  }

  /**
   * Get current stats for monitoring
   */
  getStats(): RateLimiterStats {
    this.refill();
    return {
      currentTokens: Math.floor(this.tokens * 100) / 100,
      maxTokens: this.config.maxTokens,
      requestsThisMinute: this.requestsThisMinute,
      weightUsedThisMinute: this.weightUsedThisMinute,
      isRateLimited: this.isRateLimited,
      nextAvailableAt: this.rateLimitedUntil ? new Date(this.rateLimitedUntil) : null,
    };
  }

  /**
   * Estimate how many requests can be made right now
   */
  availableRequests(cost: number = this.config.tokenCost): number {
    this.refill();
    if (this.isRateLimited) return 0;
    return Math.floor(this.tokens / cost);
  }
}

// Singleton instance for global rate limiting across all workers
let globalLimiter: TokenBucketRateLimiter | null = null;

export function getRateLimiter(config?: Partial<RateLimiterConfig>): TokenBucketRateLimiter {
  if (!globalLimiter) {
    globalLimiter = new TokenBucketRateLimiter(config);
  }
  return globalLimiter;
}

/**
 * Simple acquire function for backwards compatibility
 */
export async function acquire(): Promise<void> {
  await getRateLimiter().acquire();
}

/**
 * Report that we hit a rate limit
 */
export function reportRateLimit(): void {
  getRateLimiter().markRateLimited();
}

/**
 * Adjust for actual response size
 */
export function adjustForResponseSize(itemCount: number): void {
  getRateLimiter().adjustForResponse(itemCount);
}

export { TokenBucketRateLimiter };