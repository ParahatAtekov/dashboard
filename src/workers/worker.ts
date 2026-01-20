// src/workers/worker.ts
import { claimJobsInline, completeJobInline, failJobInline } from './queue/runtime';
import { ingestWallet } from './ingest/ingestWallet.job';
import { rollupWalletDay } from './rollup/walletDay.job';
import { rollupGlobalDay } from './rollup/globalDay.job';
import { initRateLimiter } from './ingest/rateLimiter';
import { recoverStuckJobs } from '@/repositories/jobs.repo';

const handlers: Record<string, (job: any) => Promise<any>> = {
  ingest_wallet: ingestWallet,
  rollup_wallet_day: rollupWalletDay,
  rollup_global_day: rollupGlobalDay,
};

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;
const ORG_ID = process.env.ORG_ID || '';
const USE_DISTRIBUTED_RATE_LIMIT = process.env.USE_DISTRIBUTED_RATE_LIMIT !== 'false';

async function runWorkerLoop() {
  if (!ORG_ID) {
    console.error('ORG_ID environment variable is required');
    process.exit(1);
  }

  // Initialize rate limiter (distributed by default for multi-worker safety)
  await initRateLimiter({
    useDistributed: USE_DISTRIBUTED_RATE_LIMIT,
  });

  console.log(`Worker ${WORKER_ID} starting for org ${ORG_ID}`);
  console.log(`Rate limiter mode: ${USE_DISTRIBUTED_RATE_LIMIT ? 'distributed' : 'local'}`);

  // Recover any stuck jobs from previous worker crashes
  const recoveredCount = await recoverStuckJobs(ORG_ID);
  if (recoveredCount > 0) {
    console.log(`Recovered ${recoveredCount} stuck job(s) from previous worker crash`);
  }

  while (true) {
    try {
      const jobs = await claimJobsInline(ORG_ID, WORKER_ID, 5);
      
      if (jobs.length === 0) {
        await new Promise(r => setTimeout(r, 250));
        continue;
      }

      for (const job of jobs) {
        const fn = handlers[job.type];
        
        if (!fn) {
          console.warn(`No handler for job type: ${job.type}`);
          await failJobInline(job.id, `no_handler_for_${job.type}`);
          continue;
        }

        try {
          console.log(`Processing job ${job.id} (${job.type})`);
          await fn(job);
          await completeJobInline(job.id);
          console.log(`Completed job ${job.id}`);
        } catch (e: unknown) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          console.error(`Failed job ${job.id}: ${errorMessage}`);
          await failJobInline(job.id, errorMessage);
        }
      }
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error(`Worker loop error: ${errorMessage}`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nWorker shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nWorker shutting down...');
  process.exit(0);
});

runWorkerLoop().catch(console.error);