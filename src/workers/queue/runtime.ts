// src/workers/queue/runtime.ts
import { pool } from '@/db/pool';

const LOCK_DURATION_SECONDS = 300; // 5 minutes

export interface Job {
  id: number;
  org_id: string;
  type: string;
  payload: Record<string, unknown>;
  run_at: Date;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
}

/**
 * Claims jobs using SELECT FOR UPDATE SKIP LOCKED pattern.
 * Returns jobs that are ready to run and not locked by another worker.
 */
export async function claimJobsInline(
  orgId: string,
  workerId: string,
  limit: number
): Promise<Job[]> {
  const { rows } = await pool.query(
    `
    UPDATE public.jobs
    SET
      status = 'running',
      locked_at = NOW(),
      locked_by = $2,
      lock_expires_at = NOW() + INTERVAL '${LOCK_DURATION_SECONDS} seconds',
      attempts = attempts + 1,
      updated_at = NOW()
    WHERE id IN (
      SELECT id
      FROM public.jobs
      WHERE org_id = $1
        AND status = 'queued'
        AND run_at <= NOW()
        AND (lock_expires_at IS NULL OR lock_expires_at < NOW())
      ORDER BY run_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $3
    )
    RETURNING id, org_id, type, payload, run_at, status, attempts, max_attempts, last_error
    `,
    [orgId, workerId, limit]
  );

  return rows as Job[];
}

/**
 * Marks a job as completed successfully.
 */
export async function completeJobInline(jobId: number): Promise<void> {
  await pool.query(
    `
    UPDATE public.jobs
    SET
      status = 'completed',
      locked_at = NULL,
      locked_by = NULL,
      lock_expires_at = NULL,
      updated_at = NOW()
    WHERE id = $1
    `,
    [jobId]
  );
}

/**
 * Marks a job as failed. If under max_attempts, re-queues with exponential backoff.
 */
export async function failJobInline(jobId: number, error: string): Promise<void> {
  await pool.query(
    `
    UPDATE public.jobs
    SET
      status = CASE
        WHEN attempts >= max_attempts THEN 'failed'
        ELSE 'queued'
      END,
      last_error = $2,
      locked_at = NULL,
      locked_by = NULL,
      lock_expires_at = NULL,
      run_at = CASE
        WHEN attempts >= max_attempts THEN run_at
        ELSE NOW() + (POWER(2, attempts) || ' seconds')::INTERVAL
      END,
      updated_at = NOW()
    WHERE id = $1
    `,
    [jobId, error]
  );
}