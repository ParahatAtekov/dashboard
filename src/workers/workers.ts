// src/workers/worker.ts
import { claimJobs, completeJob, failJob } from './queue';
import { ingestWallet } from './ingest/ingestWallet.job';

while (true) {
  const jobs = await claimJobs('ingest_wallet', 2);
  for (const job of jobs) {
    try {
      const res = await ingestWallet(job);
      await completeJob(job.id);
    } catch (err) {
      await failJob(job.id, err.message);
    }
  }
}
