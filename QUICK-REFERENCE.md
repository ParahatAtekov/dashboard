# Quick Reference - Job Queue Management

## Common Commands

### Check Job Health
```bash
npm run monitor-jobs
```
Exit code 0 = healthy, 1 = stuck jobs detected

### Recover Stuck Jobs
```bash
npm run recover-jobs
```
Automatically recovers jobs with expired locks

### Run Worker
```bash
npm run dev:worker
```
Auto-recovers stuck jobs on startup

## Common Issues & Quick Fixes

### Issue: Jobs stuck in "running" status
**Quick Fix:**
```bash
npm run recover-jobs
```

### Issue: Worker not processing jobs
**Check:**
```bash
npm run monitor-jobs
```
Look for:
- Jobs in "queued" status not being picked up
- Check ORG_ID environment variable
- Verify database connectivity

### Issue: Jobs failing repeatedly
**Check last error:**
```sql
SELECT id, type, last_error, attempts
FROM public.jobs
WHERE status = 'failed'
ORDER BY updated_at DESC
LIMIT 10;
```

## Environment Variables

Required:
- `ORG_ID` - Organization ID to process jobs for
- `DATABASE_URL` - PostgreSQL connection string

Optional:
- `WORKER_ID` - Defaults to `worker-{pid}`
- `USE_DISTRIBUTED_RATE_LIMIT` - Default: `true`

## Job Lifecycle

```
┌─────────┐
│ queued  │ ← Initial state
└────┬────┘
     │ Worker claims job
     ▼
┌─────────┐
│ running │ ← Lock expires after 5 minutes
└────┬────┘
     │
     ├─── Success ──► succeeded
     └─── Failure ──► queued (retry) or failed (max attempts)
```

## Monitoring Setup (Optional)

### Cron Job - Auto Recovery
```cron
# Every 10 minutes
*/10 * * * * cd /path/to/dashboard-backend && npm run recover-jobs
```

### Cron Job - Health Monitoring
```cron
# Every 5 minutes
*/5 * * * * cd /path/to/dashboard-backend && npm run monitor-jobs || mail -s "Stuck Jobs Alert" admin@example.com
```

## Key Files

- [src/repositories/jobs.repo.ts](src/repositories/jobs.repo.ts) - Job management
- [src/workers/worker.ts](src/workers/worker.ts) - Worker implementation
- [JOBS-RECOVERY.md](JOBS-RECOVERY.md) - Full recovery guide
- [CHANGELOG-fixes.md](CHANGELOG-fixes.md) - Recent fixes

## Support

For detailed troubleshooting, see [JOBS-RECOVERY.md](JOBS-RECOVERY.md)
