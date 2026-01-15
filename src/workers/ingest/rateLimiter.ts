// src/workers/ingest/rateLimiter.ts
let tokens = 1;
const refillMs = 1000;

setInterval(() => { tokens = 1; }, refillMs);

export async function acquire() {
  while (tokens <= 0) {
    await new Promise(r => setTimeout(r, 50));
  }
  tokens--;
}
