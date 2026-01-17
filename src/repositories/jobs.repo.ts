// src/repositories/jobs.repo.ts

import { pool } from '@/db/pool';
import { PoolClient } from 'pg';

export interface JobRow {
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
 * Create a new job
 */
export async function createJob(
  orgId: string,
  type: string,
  payload: Record<string, unknown>,
  runAt?: Date
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `
    INSERT INTO public.jobs (org_id, type, payload, run_at)
    VALUES ($1, $2, $3::jsonb, COALESCE($4, NOW()))
    RETURNING id
    `,
    [orgId, type, JSON.stringify(payload), runAt?.toISOString() ?? null]
  );

  return rows[0].id;
}

/**
 * Cancel pending jobs for a specific wallet
 */
export async function cancelWalletJobs(
  orgId: string,
  walletId: number,
  client?: PoolClient
): Promise<number> {
  const queryExecutor = client ?? pool;

  const result = await queryExecutor.query(
    `
    UPDATE public.jobs
    SET status = 'canceled', updated_at = NOW()
    WHERE org_id = $1
      AND type = 'ingest_wallet'
      AND status = 'queued'
      AND (payload->>'wallet_id')::bigint = $2
    `,
    [orgId, walletId]
  );

  return result.rowCount ?? 0;
}

/**
 * Claim jobs for processing (with locking)
 */
export async function claimJobs(
  orgId: string,
  workerId: string,
  limit: number,
  lockDurationSeconds: number = 300
): Promise<JobRow[]> {
  const { rows } = await pool.query<JobRow>(
    `
    UPDATE public.jobs
    SET
      status = 'running',
      locked_at = NOW(),
      locked_by = $2,
      lock_expires_at = NOW() + INTERVAL '${lockDurationSeconds} seconds',
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

  return rows;
}

/**
 * Mark job as completed
 */
export async function completeJob(jobId: number): Promise<void> {
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
 * Mark job as failed with retry logic
 */
export async function failJob(jobId: number, error: string): Promise<void> {
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