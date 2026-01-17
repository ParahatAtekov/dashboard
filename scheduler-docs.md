# Wallet Ingestion Scheduler

## Overview

The scheduler is responsible for periodically triggering wallet data ingestion from HyperLiquid while respecting API rate limits. It implements an **adaptive scheduling** strategy that prioritizes active wallets and handles errors gracefully.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SCHEDULER SYSTEM                                   │
│                                                                              │
│  ┌─────────────────┐                                                        │
│  │ schedulerRunner │  ← Entry point (runs as separate process or cron)      │
│  │                 │                                                        │
│  │  • Tick loop    │                                                        │
│  │  • Stats logging│                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────┐     ┌─────────────────┐                               │
│  │ walletScheduler │────▶│   Rate Limiter  │                               │
│  │                 │     │  (Token Bucket) │                               │
│  │ • Get due       │     │                 │                               │
│  │   wallets       │     │ • 1200 wt/min   │                               │
│  │ • Prioritize    │     │ • Backoff       │                               │
│  │ • Calculate     │     │ • Stats         │                               │
│  │   next_run_at   │     └─────────────────┘                               │
│  └────────┬────────┘                                                        │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────┐                                                        │
│  │   Job Queue     │  ← jobs table with lease-based locking                 │
│  │   (jobs table)  │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐       │
│  │     Worker      │────▶│  HyperLiquid    │────▶│   Database      │       │
│  │  (ingestWallet) │     │     API         │     │ (hl_fills_raw)  │       │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## HyperLiquid Rate Limits

| Limit | Value | Impact |
|-------|-------|--------|
| REST weight/minute | 1200 | Global across all endpoints |
| `userFillsByTime` base weight | 20 | Per request |
| Additional weight | +1 per 20 items returned | Response-based |
| Initial buffer per address | 10,000 requests | For new addresses |
| Rate limited mode | 1 req/10 sec | When over limit |
| Max fills per response | 2,000 | Pagination needed |

### Safe Operating Parameters

```
Target: 40 requests/minute = 0.67 requests/second
Weight budget: 40 * 20 = 800 weight/minute (67% of limit)
Headroom: 400 weight for response-based adjustments
```

## Scheduling Strategy

### Wallet Prioritization

Wallets are classified by activity level:

| Priority | Criteria | Ingestion Interval |
|----------|----------|-------------------|
| **Hot** | Traded in last 24h | Every 1 minute |
| **Warm** | Traded in last 7 days | Every 15 minutes |
| **Cold** | No recent activity | Every 1 hour |

### Error Handling

Exponential backoff on failures:

```
Error 1: base_interval × 2¹ = 2 minutes (hot) / 30 minutes (warm) / 2 hours (cold)
Error 2: base_interval × 2² = 4 minutes / 1 hour / 4 hours
Error 3: base_interval × 2³ = 8 minutes / 2 hours / 8 hours
...
Max backoff: 1 hour (capped at 2⁶)
```

## Database Schema Integration

### Key Tables

```sql
-- Cursor tracking per wallet
hl_ingest_cursor (
  org_id        uuid,
  wallet_id     bigint,
  cursor_ts     timestamptz,    -- Last fetched timestamp
  last_success_at timestamptz,  -- When ingestion last succeeded
  status        text,           -- 'ok' or 'error'
  error_count   integer,        -- For backoff calculation
  next_run_at   timestamptz     -- When to run next
)

-- Job queue
jobs (
  id            bigint,
  org_id        uuid,
  type          text,           -- 'ingest_wallet', 'rollup_wallet_day', etc.
  payload       jsonb,
  run_at        timestamptz,
  status        text,           -- 'queued', 'running', 'completed', 'failed'
  locked_by     text,
  lock_expires_at timestamptz
)
```

## File Structure

```
src/workers/
├── scheduler/
│   ├── index.ts              # Module exports
│   ├── walletScheduler.ts    # Core scheduling logic
│   └── schedulerRunner.ts    # Entry point & loop
├── ingest/
│   ├── rateLimiter.ts        # Token bucket rate limiter
│   ├── ingestWallet.job.ts   # Ingestion job handler
│   ├── hlClient.ts           # HyperLiquid API client
│   └── helpers.ts            # Fill parsing utilities
└── queue/
    ├── enqueue.ts            # Job creation
    └── runtime.ts            # Job claiming/completion
```

## Deployment Options

### Option A: Separate Process (Recommended)

```bash
# Terminal 1: API server
npm run dev

# Terminal 2: Worker (processes jobs)
npm run dev:worker

# Terminal 3: Scheduler (creates jobs)
ORG_ID=your-org-id npm run dev:scheduler
```

Add to `package.json`:
```json
{
  "scripts": {
    "dev:scheduler": "ts-node -r tsconfig-paths/register src/workers/scheduler/schedulerRunner.ts"
  }
}
```

### Option B: Combined Worker + Scheduler

```typescript
// In worker.ts startup
import { startScheduler } from '@/workers/scheduler';

// After worker loop starts
startScheduler({ orgId: ORG_ID });
```

### Option C: Cron-based (Serverless)

```typescript
// AWS Lambda / Vercel Cron handler
import { runOnce } from '@/workers/scheduler';

export async function handler() {
  const result = await runOnce(process.env.ORG_ID!);
  return { statusCode: 200, body: JSON.stringify(result) };
}
```

## Configuration

### Environment Variables

```bash
# Required
ORG_ID=your-organization-uuid

# Optional
SCHEDULER_TICK_INTERVAL=5000     # ms between scheduling checks
SCHEDULER_STATS_INTERVAL=60000   # ms between stats logs
```

### Programmatic Configuration

```typescript
import { startScheduler } from '@/workers/scheduler';

startScheduler({
  orgId: 'your-org-id',
  tickIntervalMs: 5000,
  statsIntervalMs: 60000,
  enableStats: true,
});
```

### Scheduler Config

```typescript
const config: SchedulerConfig = {
  hotWalletInterval: 60,       // seconds
  warmWalletInterval: 900,     // seconds
  coldWalletInterval: 3600,    // seconds
  hotThresholdHours: 24,
  warmThresholdHours: 168,     // 7 days
  maxJobsPerRun: 50,
  minTokensRequired: 20,
};
```

## Monitoring

### Stats Output

```json
{
  "wallets": {
    "total": 1000,
    "hot": 50,
    "warm": 200,
    "cold": 750,
    "errored": 5,
    "dueNow": 12
  },
  "rateLimiter": {
    "currentTokens": 85.5,
    "maxTokens": 100,
    "requestsThisMinute": 23,
    "weightUsedThisMinute": 460,
    "isRateLimited": false,
    "nextAvailableAt": null
  }
}
```

### Key Metrics to Monitor

1. **Queue depth**: Jobs in 'queued' status
2. **Processing latency**: Time from enqueue to completion
3. **Error rate**: Failed jobs / total jobs
4. **Rate limit hits**: How often we back off
5. **Wallet coverage**: % of wallets ingested within SLA

## Capacity Planning

### Example: 10,000 Wallets

Assumptions:
- 5% hot (500 wallets, 1 min interval)
- 15% warm (1,500 wallets, 15 min interval)
- 80% cold (8,000 wallets, 60 min interval)

Requests per minute:
```
Hot:  500 / 1 = 500 req/min    → 8.3 req/sec
Warm: 1500 / 15 = 100 req/min  → 1.7 req/sec
Cold: 8000 / 60 = 133 req/min  → 2.2 req/sec
Total: 733 req/min             → 12.2 req/sec
```

**Problem**: This exceeds our 40 req/min limit!

### Solution: Adaptive Scheduling

1. **Longer intervals for less active wallets**
   - Cold: 6 hours instead of 1 hour → 22 req/min
   - Total: 622 req/min → still too high

2. **Batch within rate limits**
   - Process max 40 wallets/minute
   - Prioritize hot > warm > cold
   - Cold wallets may have longer actual intervals

3. **Accept eventual consistency**
   - Hot wallets: real-time (within minutes)
   - Warm wallets: near real-time (within 30 min)
   - Cold wallets: eventual (within hours)

## Integration Checklist

- [ ] Add scheduler scripts to package.json
- [ ] Create `hl_ingest_cursor` entries for all wallets
- [ ] Set up monitoring for queue depth and error rates
- [ ] Configure alerts for rate limit hits
- [ ] Test with small wallet set first
- [ ] Gradually increase to full wallet set