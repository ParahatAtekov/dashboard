# Fixes for HyperLiquid Dashboard Backend

This directory contains all fixes for the issues identified in the codebase.

## Issues Fixed

### 🔴 Critical Issues

#### 1. Missing `wallets.id` auto-generation
**Problem**: `wallets.id` column had no default value, causing INSERT failures.
**Fix**: Migration adds sequence and sets default.
**File**: `migrations/001_fix_schema_issues.sql`

#### 2. `citext` extension dependency
**Problem**: Code uses `$1::citext` but extension might not be enabled.
**Fix**: Migration enables `citext` extension and ensures column type.
**File**: `migrations/001_fix_schema_issues.sql`

### 🟡 Medium Issues

#### 3. Label update doesn't allow clearing
**Problem**: `COALESCE(EXCLUDED.label, wallets.label)` prevents setting label to NULL.
**Fix**: Changed upsertWallet to properly handle `undefined` vs `null` vs `string`.
**File**: `src/repositories/wallets.repo.ts`

#### 4. Health check requires auth
**Problem**: `/health` endpoint defined after auth middleware.
**Fix**: Moved health check before auth middleware.
**File**: `src/index.ts`

#### 5. Rate limiter not distributed
**Problem**: Singleton rate limiter only works within single process.
**Fix**: Added PostgreSQL-backed distributed rate limiting.
**File**: `src/workers/ingest/rateLimiter.ts`

### 🟢 Low Issues

#### 6. Missing FK constraints
**Problem**: No referential integrity between tables.
**Fix**: Migration adds all FK constraints with CASCADE delete.
**File**: `migrations/001_fix_schema_issues.sql`

---

## How to Apply Fixes

### Step 1: Run Database Migration

Execute in Supabase SQL Editor:

```sql
-- Copy contents of migrations/001_fix_schema_issues.sql
```

This will:
- Enable `citext` extension
- Add sequences for `wallets.id`, `jobs.id`, `hl_fills_raw.id`
- Add foreign key constraints
- Add unique constraints for idempotency
- Add primary keys if missing

### Step 2: Replace Source Files

Copy these files to your project:

```bash
# Core fixes
cp src/index.ts                           <your-project>/src/
cp src/repositories/wallets.repo.ts       <your-project>/src/repositories/
cp src/services/wallets.registration.service.ts <your-project>/src/services/

# Worker fixes
cp src/workers/worker.ts                  <your-project>/src/workers/
cp src/workers/ingest/rateLimiter.ts      <your-project>/src/workers/ingest/
cp src/workers/ingest/ingestWallet.job.ts <your-project>/src/workers/ingest/
cp src/workers/scheduler/walletScheduler.ts     <your-project>/src/workers/scheduler/
cp src/workers/scheduler/schedulerRunner.ts     <your-project>/src/workers/scheduler/
```

### Step 3: Environment Variables

Add these optional environment variables:

```bash
# Set to 'false' to use local rate limiting (single worker only)
USE_DISTRIBUTED_RATE_LIMIT=true
```

---

## Detailed Changes

### `src/index.ts`
- Moved `/health` endpoint BEFORE auth middleware
- Added `/ready` endpoint for Kubernetes-style readiness checks

### `src/repositories/wallets.repo.ts`
- `upsertWallet(address, label?)` now properly handles:
  - `label = undefined` → preserve existing label on conflict
  - `label = null` → clear existing label on conflict
  - `label = "string"` → set new label on conflict
- Added `walletExistsByAddress()` helper

### `src/workers/ingest/rateLimiter.ts`
- Added distributed mode using PostgreSQL table
- Automatically creates `rate_limit_state` table
- Falls back to local mode if not initialized
- All workers share rate limit state
- Thread-safe with row-level locking

### `src/workers/ingest/ingestWallet.job.ts`
- Made `reportRateLimit()` and `adjustForResponseSize()` async
- Added proper typing for return values
- Uses correct unique constraint name in ON CONFLICT

### `src/workers/worker.ts`
- Calls `initRateLimiter()` on startup
- Configurable via `USE_DISTRIBUTED_RATE_LIMIT` env var
- Added graceful shutdown handlers

### `src/workers/scheduler/*.ts`
- Handle async rate limiter methods
- Properly await `availableRequests()` which can be async

---

## Database Schema Changes

### New Table: `rate_limit_state`
```sql
CREATE TABLE public.rate_limit_state (
  key TEXT PRIMARY KEY,
  tokens NUMERIC NOT NULL,
  last_refill TIMESTAMPTZ NOT NULL,
  requests_this_minute INT NOT NULL DEFAULT 0,
  weight_this_minute INT NOT NULL DEFAULT 0,
  minute_start TIMESTAMPTZ NOT NULL,
  is_rate_limited BOOLEAN NOT NULL DEFAULT FALSE,
  rate_limited_until TIMESTAMPTZ
);
```

### New Sequences
- `wallets_id_seq`
- `jobs_id_seq`
- `hl_fills_raw_id_seq`

### New Foreign Keys
- `org_wallets.wallet_id` → `wallets.id` (CASCADE)
- `org_wallets.org_id` → `orgs.id` (CASCADE)
- `hl_ingest_cursor.wallet_id` → `wallets.id` (CASCADE)
- `hl_ingest_cursor.org_id` → `orgs.id` (CASCADE)
- `wallet_day_metrics.wallet_id` → `wallets.id` (CASCADE)
- `jobs.org_id` → `orgs.id` (CASCADE)
- `user_profiles.org_id` → `orgs.id` (CASCADE)

### New Unique Index
- `hl_fills_raw_org_wallet_fill_unique` on `(org_id, wallet_id, hl_fill_id)`

---

## Testing

After applying fixes, verify:

1. **Health check works without auth**:
   ```bash
   curl http://localhost:3000/health
   # Should return {"status":"ok","timestamp":"..."}
   ```

2. **Wallet creation works**:
   ```bash
   curl -X POST http://localhost:3000/api/v1/wallets \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"address":"0x1234567890123456789012345678901234567890"}'
   ```

3. **Rate limiter table created** (check Supabase):
   ```sql
   SELECT * FROM public.rate_limit_state;
   ```

4. **FK constraints exist**:
   ```sql
   SELECT constraint_name, table_name 
   FROM information_schema.table_constraints 
   WHERE constraint_type = 'FOREIGN KEY';
   ```