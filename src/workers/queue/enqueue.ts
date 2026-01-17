// src/workers/queue/enqueue.ts

import { createJob } from '@/repositories/jobs.repo';

export async function enqueueJob(
  orgId: string,
  type: string,
  payload: Record<string, unknown>,
  runAt?: Date
): Promise<number> {
  return createJob(orgId, type, payload, runAt);
}