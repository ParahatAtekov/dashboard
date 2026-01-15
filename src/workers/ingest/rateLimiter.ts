// src/workers/ingest/rateLimiter.ts

/**
 * Simple token bucket rate limiter for Hyperliquid API.
 * Allows 1 request per second globally.
 */

let tokens = 1;
const maxTokens = 1;
const refillMs = 1000;

// Refill token every second
setInterval(() => {
  tokens = Math.min(tokens + 1, maxTokens);
}, refillMs);

/**
 * Acquires a token, waiting if none are available.
 * Use this before making API calls to respect rate limits.
 */
export async function acquire(): Promise<void> {
  while (tokens <= 0) {
    await new Promise(r => setTimeout(r, 50));
  }
  tokens--;
}