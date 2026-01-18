// src/workers/scheduler/walletScheduler.ts

import * as cursorRepo from '@/repositories/cursor.repo';
import * as orgWalletsRepo from '@/repositories/orgWallets.repo';
import * as jobsRepo from '@/repositories/jobs.repo';
import { getRateLimiter } from '@/workers/ingest/rateLimiter';

// ============================================
// Types
// ============================================

export interface SchedulerConfig {
  hotWalletInterval: number;
  warmWalletInterval: number;
  coldWalletInterval: number;
  hotThresholdHours: number;
  warmThresholdHours: number;
  maxJobsPerRun: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  hotWalletInterval: 60,
  warmWalletInterval: 900,
  coldWalletInterval: 3600,
  hotThresholdHours: 24,
  warmThresholdHours: 168,
  maxJobsPerRun: 50,
};

// ============================================
// Scheduling Logic (no SQL here)
// ============================================

export function calculateNextRunAt(
  priority: 'hot' | 'warm' | 'cold',
  errorCount: number,
  config: Partial<SchedulerConfig> = {}
): Date {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  let baseIntervalSeconds: number;
  switch (priority) {
    case 'hot':
      baseIntervalSeconds = cfg.hotWalletInterval;
      break;
    case 'warm':
      baseIntervalSeconds = cfg.warmWalletInterval;
      break;
    case 'cold':
    default:
      baseIntervalSeconds = cfg.coldWalletInterval;
  }

  if (errorCount > 0) {
    const backoffMultiplier = Math.pow(2, Math.min(errorCount, 6));
    baseIntervalSeconds = Math.min(baseIntervalSeconds * backoffMultiplier, 3600);
  }

  return new Date(Date.now() + baseIntervalSeconds * 1000);
}

function determinePriority(
  lastTradeTs: Date | null,
  config: SchedulerConfig
): 'hot' | 'warm' | 'cold' {
  if (!lastTradeTs) return 'cold';

  const hoursSinceLastTrade = (Date.now() - lastTradeTs.getTime()) / (1000 * 60 * 60);

  if (hoursSinceLastTrade < config.hotThresholdHours) return 'hot';
  if (hoursSinceLastTrade < config.warmThresholdHours) return 'warm';
  return 'cold';
}

// ============================================
// Service Functions
// ============================================

export async function scheduleWalletIngestion(
  orgId: string,
  config: Partial<SchedulerConfig> = {}
): Promise<{ scheduled: number; skipped: number }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const limiter = getRateLimiter();

  // availableRequests can be sync or async depending on mode
  const availableRequests = await Promise.resolve(limiter.availableRequests());
  if (availableRequests === 0) {
    console.log('[Scheduler] Rate limiter has no capacity, skipping');
    return { scheduled: 0, skipped: 0 };
  }

  // Get wallets due for ingestion
  const wallets = await cursorRepo.getWalletsDueForIngestion(
    orgId,
    cfg.hotThresholdHours,
    cfg.warmThresholdHours,
    cfg.maxJobsPerRun
  );

  if (wallets.length === 0) {
    return { scheduled: 0, skipped: 0 };
  }

  // Check for existing pending jobs
  const walletIds = wallets.map(w => w.wallet_id);
  const existingWalletIds = await orgWalletsRepo.getWalletIdsWithPendingJobs(orgId, walletIds);

  let scheduled = 0;
  let skipped = 0;

  for (const wallet of wallets) {
    if (existingWalletIds.has(wallet.wallet_id)) {
      skipped++;
      continue;
    }

    if (scheduled >= availableRequests) {
      console.log(`[Scheduler] Rate limit capacity reached, scheduled ${scheduled} jobs`);
      break;
    }

    await jobsRepo.createJob(orgId, 'ingest_wallet', {
      org_id: wallet.org_id,
      wallet_id: wallet.wallet_id,
      address: wallet.address,
    });

    scheduled++;
  }

  if (scheduled > 0 || skipped > 0) {
    console.log(`[Scheduler] Scheduled ${scheduled} jobs, skipped ${skipped}`);
  }

  return { scheduled, skipped };
}

export async function updateCursorAfterIngestion(
  orgId: string,
  walletId: number,
  success: boolean,
  newCursorTs?: Date
): Promise<void> {
  const cfg = DEFAULT_CONFIG;

  if (success && newCursorTs) {
    const lastTradeTs = await cursorRepo.getLastTradeTs(orgId, walletId);
    const priority = determinePriority(lastTradeTs, cfg);
    const nextRunAt = calculateNextRunAt(priority, 0);

    await cursorRepo.updateCursorSuccess(orgId, walletId, newCursorTs, nextRunAt);
  } else {
    const cursor = await cursorRepo.getCursor(orgId, walletId);
    const currentErrorCount = cursor?.error_count ?? 0;
    const nextErrorCount = currentErrorCount + 1;
    const nextRunAt = calculateNextRunAt('cold', nextErrorCount);

    await cursorRepo.updateCursorFailure(orgId, walletId, nextErrorCount, nextRunAt);

    console.warn(`[Scheduler] Wallet ${walletId} failed, error count: ${nextErrorCount}`);
  }
}

export async function getSchedulerStats(orgId: string) {
  return cursorRepo.getSchedulerStats(orgId);
}