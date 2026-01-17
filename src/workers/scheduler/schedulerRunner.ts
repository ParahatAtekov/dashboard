// src/workers/scheduler/schedulerRunner.ts

import { scheduleWalletIngestion, getSchedulerStats } from './walletScheduler';
import { getRateLimiter } from '@/workers/ingest/rateLimiter';

export interface SchedulerRunnerConfig {
  orgId: string;
  tickIntervalMs: number;
  statsIntervalMs: number;
  enableStats: boolean;
}

const DEFAULT_RUNNER_CONFIG: SchedulerRunnerConfig = {
  orgId: '',
  tickIntervalMs: 5000,
  statsIntervalMs: 60000,
  enableStats: true,
};

let isRunning = false;
let tickTimer: NodeJS.Timeout | null = null;
let statsTimer: NodeJS.Timeout | null = null;

async function tick(orgId: string): Promise<void> {
  try {
    await scheduleWalletIngestion(orgId);
  } catch (error) {
    console.error('[Scheduler Tick] Error:', error);
  }
}

async function logStats(orgId: string): Promise<void> {
  try {
    const [schedulerStats, rateLimiterStats] = await Promise.all([
      getSchedulerStats(orgId),
      Promise.resolve(getRateLimiter().getStats()),
    ]);

    console.log('[Scheduler Stats]', JSON.stringify({
      wallets: schedulerStats,
      rateLimiter: rateLimiterStats,
    }, null, 2));
  } catch (error) {
    console.error('[Scheduler Stats] Error:', error);
  }
}

export function startScheduler(config: Partial<SchedulerRunnerConfig>): void {
  if (isRunning) {
    console.warn('[Scheduler] Already running');
    return;
  }

  const cfg = { ...DEFAULT_RUNNER_CONFIG, ...config };

  if (!cfg.orgId) {
    throw new Error('orgId is required to start scheduler');
  }

  isRunning = true;
  console.log(`[Scheduler] Starting with tick interval ${cfg.tickIntervalMs}ms`);

  const runTick = async () => {
    if (!isRunning) return;
    await tick(cfg.orgId);
    tickTimer = setTimeout(runTick, cfg.tickIntervalMs);
  };

  if (cfg.enableStats) {
    const runStats = async () => {
      if (!isRunning) return;
      await logStats(cfg.orgId);
      statsTimer = setTimeout(runStats, cfg.statsIntervalMs);
    };
    runStats();
  }

  runTick();
}

export function stopScheduler(): void {
  if (!isRunning) {
    console.warn('[Scheduler] Not running');
    return;
  }

  isRunning = false;
  
  if (tickTimer) {
    clearTimeout(tickTimer);
    tickTimer = null;
  }
  
  if (statsTimer) {
    clearTimeout(statsTimer);
    statsTimer = null;
  }

  console.log('[Scheduler] Stopped');
}

export function isSchedulerRunning(): boolean {
  return isRunning;
}

export async function runOnce(orgId: string): Promise<{ scheduled: number; skipped: number }> {
  return scheduleWalletIngestion(orgId);
}

// Standalone entry point
if (require.main === module) {
  const ORG_ID = process.env.ORG_ID;
  const TICK_INTERVAL = parseInt(process.env.SCHEDULER_TICK_INTERVAL || '5000');
  const STATS_INTERVAL = parseInt(process.env.SCHEDULER_STATS_INTERVAL || '60000');

  if (!ORG_ID) {
    console.error('ORG_ID environment variable is required');
    process.exit(1);
  }

  console.log(`Starting scheduler for org ${ORG_ID}`);

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    stopScheduler();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    stopScheduler();
    process.exit(0);
  });

  startScheduler({
    orgId: ORG_ID,
    tickIntervalMs: TICK_INTERVAL,
    statsIntervalMs: STATS_INTERVAL,
  });
}