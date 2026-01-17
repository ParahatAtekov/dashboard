// src/workers/queue/runtime.ts

import * as jobsRepo from '@/repositories/jobs.repo';

export type Job = jobsRepo.JobRow;

export async function claimJobsInline(
  orgId: string,
  workerId: string,
  limit: number
): Promise<Job[]> {
  return jobsRepo.claimJobs(orgId, workerId, limit);
}

export async function completeJobInline(jobId: number): Promise<void> {
  return jobsRepo.completeJob(jobId);
}

export async function failJobInline(jobId: number, error: string): Promise<void> {
  return jobsRepo.failJob(jobId, error);
}