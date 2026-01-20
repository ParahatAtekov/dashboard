# Bug Fixes & Improvements

## 2026-01-20: Job Queue Reliability Improvements

### Issues Fixed

#### 1. Jobs Getting Stuck in "running" Status
**Problem**: When workers crashed or were killed, jobs remained in "running" status indefinitely.

**Root Cause**:
- Workers set `lock_expires_at` timeout but didn't reclaim expired "running" jobs
- Only checked for expired locks on "queued" jobs, not "running" ones
- No automatic recovery on worker startup

**Fix**:
- Updated `claimJobs()` to reclaim stuck "running" jobs with expired locks
- Added `recoverStuckJobs()` function to manually recover stuck jobs
- Worker now auto-recovers stuck jobs on startup
- Added monitoring and recovery scripts

**Files Changed**:
- `src/repositories/jobs.repo.ts` - Enhanced job claiming logic
- `src/workers/worker.ts` - Added auto-recovery on startup
- `src/scripts/recover-stuck-jobs.ts` - New manual recovery script
- `src/scripts/job-monitor.ts` - New monitoring script
- `package.json` - Added npm scripts: `recover-jobs`, `monitor-jobs`

#### 2. Hyperliquid API 422 Error
**Problem**: Worker failed with "422 Unprocessable Entity" from Hyperliquid API.

**Root Cause**: Cursor at epoch 0 minus 10-minute overlap resulted in negative timestamp (-600000ms), which Hyperliquid API rejected.

**Fix**: Ensure `startTime` is never negative using `Math.max(0, ...)`.

**Files Changed**:
- `src/workers/ingest/ingestWallet.job.ts:38`

#### 3. Missing Database Partitions
**Problem**: "no partition of relation 'hl_fills_raw' found for row" error.

**Root Cause**: Table partitioned by month, but only 2026 partitions existed. Historical 2025 data couldn't be inserted.

**Fix**: Created partitions for 2025-05 through 2025-12.

**Database Changes**:
```sql
CREATE TABLE hl_fills_raw_2025_05 ... 2025_12
```

#### 4. Side Constraint Mismatch
**Problem**: Database constraint violation on `side` field.

**Root Cause**: Constraint expected 'B'/'S' but Hyperliquid API returns 'A'/'B' (Ask/Bid).

**Fix**: Updated constraint to accept 'A' and 'B'.

**Database Changes**:
```sql
ALTER TABLE hl_fills_raw DROP CONSTRAINT hl_fills_raw_side_check;
ALTER TABLE hl_fills_raw ADD CONSTRAINT hl_fills_raw_side_check 
  CHECK (side = ANY (ARRAY['A'::text, 'B'::text]));
```

#### 5. Invalid Job Status
**Problem**: "new row violates check constraint 'jobs_status_check'" error.

**Root Cause**: Code used 'completed' status but constraint only allows 'succeeded'.

**Fix**: Changed status from 'completed' to 'succeeded'.

**Files Changed**:
- `src/repositories/jobs.repo.ts:110`

### New Features

#### Job Monitoring
```bash
npm run monitor-jobs
```
Shows job statistics and detects stuck jobs.

#### Job Recovery
```bash
npm run recover-jobs [org-id]
```
Manually recovers stuck jobs (also runs automatically on worker startup).

### Testing
All three wallets now successfully ingesting data:
- Wallet 1: 3,966 fills (May-Oct 2025)
- Wallet 2: 1,231 fills (Jan 2026)
- Wallet 3: 2,000 fills (Nov-Dec 2025)

### Documentation
- Added `JOBS-RECOVERY.md` with comprehensive recovery guide
- Includes troubleshooting, monitoring, and best practices
