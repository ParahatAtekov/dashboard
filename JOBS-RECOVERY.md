# Job Queue Recovery Guide

## Why Jobs Get Stuck

Jobs can get stuck in "running" status when:

1. **Worker Crashes** - Unexpected errors or out-of-memory conditions
2. **Worker Killed** - Manual termination (Ctrl+C), process signals (SIGTERM, SIGKILL)
3. **Network Issues** - Lost database connections during job processing
4. **Deployment** - Rolling updates or container restarts
5. **Server Crashes** - Hardware failures or system reboots

## How Recovery Works

### Automatic Recovery

The system has **three layers of automatic recovery**:

#### 1. Worker Startup Recovery
Every time a worker starts, it automatically recovers stuck jobs:

```typescript
// On worker startup
const recoveredCount = await recoverStuckJobs(ORG_ID);
if (recoveredCount > 0) {
  console.log(`Recovered ${recoveredCount} stuck job(s)`);
}
```

#### 2. Lock Expiration Recovery
Jobs have a 5-minute lock timeout. The `claimJobs()` function automatically reclaims jobs with expired locks:

```sql
-- Reclaim stuck running jobs with expired locks
(status = 'running' AND lock_expires_at < NOW())
```

#### 3. Retry Logic
Failed jobs automatically retry with exponential backoff:
- Attempt 1: Retry immediately
- Attempt 2: Retry after 2 seconds
- Attempt 3: Retry after 4 seconds
- Attempt 4: Retry after 8 seconds
- ... up to max_attempts (default: 10)

### Manual Recovery

#### Monitor Jobs
Check for stuck jobs:

```bash
npm run monitor-jobs
```

Output:
```
📊 Job Queue Statistics:
────────────────────────────────────────────────────────────
Org: c49d3d1f-c66d-475e-9c22-565f5d42237b
  running   : 1 (oldest: 18m)
  succeeded : 9

🚨 Stuck Jobs (running with expired locks):
────────────────────────────────────────────────────────────
⚠️  1 job(s) are stuck!
   Run: npm run recover-jobs
```

#### Recover Stuck Jobs
Manually recover stuck jobs:

```bash
npm run recover-jobs
```

For a specific org:
```bash
npm run recover-jobs c49d3d1f-c66d-475e-9c22-565f5d42237b
```

### Direct SQL Recovery (Emergency)

If scripts don't work, use SQL directly:

```sql
-- Check stuck jobs
SELECT id, type, status, locked_by, lock_expires_at, last_error
FROM public.jobs
WHERE org_id = 'your-org-id'
  AND status = 'running'
  AND lock_expires_at < NOW();

-- Recover all stuck jobs for an org
UPDATE public.jobs
SET
  status = 'queued',
  locked_at = NULL,
  locked_by = NULL,
  lock_expires_at = NULL,
  run_at = NOW()
WHERE org_id = 'your-org-id'
  AND status = 'running'
  AND lock_expires_at < NOW();
```

## Monitoring & Alerting

### Set Up Cron Job
Add to crontab to automatically monitor and alert:

```bash
# Check for stuck jobs every 5 minutes
*/5 * * * * cd /path/to/dashboard-backend && npm run monitor-jobs || echo "Stuck jobs detected!"

# Auto-recover stuck jobs every 10 minutes
*/10 * * * * cd /path/to/dashboard-backend && npm run recover-jobs
```

### Health Check Endpoint
Consider adding a health check endpoint that includes job queue status:

```typescript
app.get('/health/jobs', async (req, res) => {
  const stuckCount = await pool.query(
    'SELECT COUNT(*) FROM jobs WHERE status = $1 AND lock_expires_at < NOW()',
    ['running']
  );

  res.json({
    healthy: stuckCount.rows[0].count === 0,
    stuck_jobs: parseInt(stuckCount.rows[0].count)
  });
});
```

## Best Practices

### 1. Graceful Shutdown
Always handle shutdown signals properly:

```typescript
process.on('SIGTERM', async () => {
  console.log('Worker shutting down gracefully...');
  // Complete current job before exiting
  await currentJob?.wait();
  process.exit(0);
});
```

### 2. Short Lock Timeouts
Keep lock timeouts reasonable (5 minutes default). Adjust if needed:

```typescript
await claimJobs(orgId, workerId, limit, 300); // 5 minutes
```

### 3. Idempotent Jobs
Design jobs to be idempotent (safe to run multiple times):

```typescript
// Use ON CONFLICT to make inserts idempotent
INSERT INTO hl_fills_raw (...)
VALUES (...)
ON CONFLICT (org_id, wallet_id, hl_fill_id, ts) DO NOTHING;
```

### 4. Monitor Regularly
Set up monitoring to catch issues early:
- Alert when jobs are stuck for > 10 minutes
- Alert when failure rate > 10%
- Track average job duration

### 5. Database Backups
Regular backups help recover from data corruption:
```bash
pg_dump -h host -U user -d database > backup.sql
```

## Troubleshooting

### Jobs Keep Getting Stuck
1. Check worker logs for errors
2. Increase lock timeout if jobs need more time
3. Review job logic for infinite loops or blocking operations
4. Check database connection stability

### Jobs Fail After Recovery
1. Review `last_error` column in jobs table
2. Check if external APIs are down (e.g., Hyperliquid)
3. Verify database partitions exist for the data range
4. Check for schema changes or constraint violations

### Worker Not Claiming Jobs
1. Verify `ORG_ID` environment variable is set
2. Check worker has database access
3. Look for lock contention (multiple workers claiming same jobs)
4. Review `FOR UPDATE SKIP LOCKED` behavior

## Related Files

- [src/repositories/jobs.repo.ts](src/repositories/jobs.repo.ts) - Job repository with recovery logic
- [src/workers/worker.ts](src/workers/worker.ts) - Worker with auto-recovery on startup
- [src/scripts/recover-stuck-jobs.ts](src/scripts/recover-stuck-jobs.ts) - Manual recovery script
- [src/scripts/job-monitor.ts](src/scripts/job-monitor.ts) - Job monitoring script
