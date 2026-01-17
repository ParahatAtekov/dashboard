I'll read through the project files to give you a comprehensive technical explanation.Now I have the complete picture. Let me explain this project comprehensively.

---

## Technical Deep-Dive: HyperLiquid DeFi Analytics Dashboard

This is a **backend system for tracking and analyzing wallet activity** on HyperLiquid, a decentralized perpetual exchange. The architecture follows a strict "data correctness first" philosophy.

---

### 1. System Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Workers   │ ──▶ │  Database   │ ◀── │   Backend   │ ◀── │     UI      │
│ (Ingestion) │     │ (Supabase)  │     │  (Express)  │     │  (Future)   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
      │                    │                   │
      ▼                    ▼                   ▼
 HyperLiquid API    Source of Truth      Read-Only APIs
```

**Key principle**: Data flows in ONE direction. Workers write, backend reads, UI displays.

---

### 2. Database Schema (Supabase/PostgreSQL)

**8 tables** organized into three categories:

#### A. Core Entity Tables
| Table | Purpose |
|-------|---------|
| `orgs` | Organizations/tenants (multi-tenant ready) |
| `wallets` | Tracked wallet addresses |
| `org_wallets` | Junction table linking orgs to wallets |
| `user_profiles` | Users with roles and org membership |

#### B. Raw Data Tables (Append-Only)
| Table | Purpose |
|-------|---------|
| `hl_fills_raw` | Parent table for trade fills |
| `hl_fills_raw_2026_01` through `_04` | **Monthly partitions** for scalability |

The partitioning strategy handles millions of rows/day with predictable query performance.

#### C. Derived/Aggregated Tables
| Table | Purpose |
|-------|---------|
| `wallet_day_metrics` | Per-wallet daily aggregates (volume, trades) |
| `global_day_metrics` | Platform-wide daily metrics (DAU, total volume) |
| `hl_ingest_cursor` | Tracks ingestion progress per wallet |
| `jobs` | Job queue for workers |

---

### 3. Worker System (Background Jobs)

The workers pull data from HyperLiquid and process it.

#### Job Types (Chained Execution)
```
ingest_wallet → rollup_wallet_day → rollup_global_day
```

**`ingestWallet.job.ts`** - The core ingestion logic:
```typescript
// Key concepts:
1. Cursor-based ingestion (remembers where it left off)
2. 10-minute overlap window (catches late-arriving fills)
3. Idempotent inserts (ON CONFLICT DO NOTHING)
4. Rate limiting (1 request/second)
```

**`walletDay.job.ts`** - Aggregates raw fills into daily metrics:
- Sums spot volume, perp volume, trade counts
- Completely rebuilds from raw data (deterministic)
- Chains to global rollup

**`globalDay.job.ts`** - Aggregates wallet metrics into platform metrics:
- Calculates DAU (wallets with trades)
- Sums platform-wide volumes
- Computes averages per user

#### Job Queue Pattern
The `jobs` table implements a **distributed job queue** with:
- **Lease-based locking** (`SELECT FOR UPDATE SKIP LOCKED`)
- **Exponential backoff** on failures
- **Automatic retry** up to `max_attempts`
- **Crash safety** (locks expire, jobs get re-claimed)

```typescript
// From runtime.ts - this is a proper distributed lock pattern
WHERE id IN (
  SELECT id FROM jobs
  WHERE status = 'queued' AND run_at <= NOW()
  FOR UPDATE SKIP LOCKED  // ← Critical for concurrency
  LIMIT $3
)
```

---

### 4. API Layer (Express.js)

Three endpoints, all **read-only** and **cacheable**:

| Endpoint | Cache TTL | Purpose |
|----------|-----------|---------|
| `GET /api/v1/dashboard/summary` | 60s | Latest day's metrics |
| `GET /api/v1/metrics/global` | 300s | Time-series data (7d/30d/90d) |
| `GET /api/v1/wallets/top` | 120s | Leaderboard by volume |

#### Authentication Flow
```
Request → auth.ts → context.ts → controller
           │           │
           ▼           ▼
      JWT verify   Resolve user→org→role
```

The middleware chain:
1. `auth.ts` verifies Supabase JWT
2. `context.ts` looks up user's org and role from `user_profiles`
3. Controllers access `req.user.orgId` for data filtering

---

### 5. Key Technical Patterns

#### A. Idempotent Writes
All raw data inserts use `ON CONFLICT DO NOTHING`:
```sql
INSERT INTO hl_fills_raw (...)
ON CONFLICT DO NOTHING  -- Safe retries, no duplicates
```

#### B. Deterministic Aggregates
Metrics are **recomputed from raw data**, not incremented:
```sql
-- Wrong: UPDATE metrics SET volume = volume + new_volume
-- Right: SELECT SUM(...) FROM raw_fills WHERE day = $1
```

This allows full rebuilds if data is wrong.

#### C. Multi-Tenant by Design
Every table includes `org_id`:
```typescript
WHERE org_id = $1  // Always filtered by organization
```
Currently single-tenant operationally, but zero-cost to expand.

#### D. No ORM
All SQL is explicit:
```typescript
const { rows } = await pool.query(`
  SELECT day, dau, spot_volume_usd
  FROM global_day_metrics
  WHERE org_id = $1
`, [orgId]);
```
Benefits: predictable performance, clear query ownership.

---

### 6. File Structure

```
src/
├── api/
│   ├── middleware/
│   │   ├── auth.ts          # JWT verification
│   │   └── context.ts       # User→Org resolution
│   └── v1/
│       ├── index.ts         # Route definitions
│       ├── dashboard.controller.ts
│       ├── metrics.controller.ts
│       └── wallets.controller.ts
├── config/
│   └── env.ts               # Zod-validated env vars
├── db/
│   └── pool.ts              # PostgreSQL connection pool
├── repositories/            # SQL queries only
│   ├── globalMetrics.repo.ts
│   └── walletMetrics.repo.ts
├── services/                # Business logic
│   ├── auth.service.ts
│   ├── dashboard.service.ts
│   ├── metrics.service.ts
│   └── wallets.service.ts
├── workers/
│   ├── ingest/
│   │   ├── helpers.ts       # Fill parsing utilities
│   │   ├── hlClient.ts      # HyperLiquid API client
│   │   ├── ingestWallet.job.ts
│   │   └── rateLimiter.ts   # Token bucket
│   ├── queue/
│   │   ├── enqueue.ts       # Job creation
│   │   └── runtime.ts       # Job claiming/completion
│   ├── rollup/
│   │   ├── globalDay.job.ts
│   │   └── walletDay.job.ts
│   ├── runner.ts            # Worker orchestrator
│   └── worker.ts            # Entry point
└── index.ts                 # API entry point
```
