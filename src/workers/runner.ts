// src/workers/runner.ts
import { claimJobsInline, completeJobInline, failJobInline } from '@/workers/queue/runtime';
import { ingestWallet } from '@/workers/ingest/ingestWallet.job';
import { rollupWalletDay } from '@/workers/rollup/walletDay.job';
import { rollupGlobalDay } from '@/workers/rollup/globalDay.job';

const handlers: Record<string, (job: any) => Promise<any>> = {
  ingest_wallet: ingestWallet,
  rollup_wallet_day: rollupWalletDay,
  rollup_global_day: rollupGlobalDay
};

export async function runWorkerLoop(workerId: string, orgId: string) {
  console.log(`Worker ${workerId} starting for org ${orgId}`);
  
  while (true) {
    const jobs = await claimJobsInline(orgId, workerId, 5);
    
    if (jobs.length === 0) {
      await new Promise(r => setTimeout(r, 250));
      continue;
    }

    for (const job of jobs) {
      const fn = handlers[job.type];
      
      if (!fn) {
        await failJobInline(job.id, `no_handler_for_${job.type}`);
        continue;
      }

      try {
        await fn(job);
        await completeJobInline(job.id);
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        await failJobInline(job.id, errorMessage);
      }
    }
  }
}