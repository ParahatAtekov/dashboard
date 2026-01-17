// src/repositories/cursor.repo.ts

import { pool } from '@/db/pool';
import { PoolClient } from 'pg';

export interface CursorRow {
  org_id: string;
  wallet_id: number;
  cursor_ts: Date;
  last_success_at: Date | null;
  status: string;
  error_count: number;
  next_run_at: Date;
}

/**
 * Initialize cursor for a wallet (idempotent)
 */
export async function initializeCursor(
  orgId: string,
  walletId: number,
  client?: PoolClient
): Promise<void> {
  const queryExecutor = client ?? pool;

  await queryExecutor.query(
    `
    INSERT INTO public.hl_ingest_cursor (org_id, wallet_id, cursor_ts, next_run_at)
    VALUES ($1, $2, '1970-01-01'::timestamptz, NOW())
    ON CONFLICT (org_id, wallet_id) DO NOTHING
    `,
    [orgId, walletId]
  );
}

/**
 * Get cursor for a wallet
 */
export async function getCursor(
  orgId: string,
  walletId: number
): Promise<CursorRow | null> {
  const { rows } = await pool.query<CursorRow>(
    `
    SELECT org_id, wallet_id, cursor_ts, last_success_at, status, error_count, next_run_at
    FROM public.hl_ingest_cursor
    WHERE org_id = $1 AND wallet_id = $2
    `,
    [orgId, walletId]
  );

  return rows[0] ?? null;
}

/**
 * Update cursor after successful ingestion
 */
export async function updateCursorSuccess(
  orgId: string,
  walletId: number,
  cursorTs: Date,
  nextRunAt: Date
): Promise<void> {
  await pool.query(
    `
    UPDATE public.hl_ingest_cursor
    SET
      cursor_ts = $3,
      last_success_at = NOW(),
      error_count = 0,
      status = 'ok',
      next_run_at = $4
    WHERE org_id = $1 AND wallet_id = $2
    `,
    [orgId, walletId, cursorTs, nextRunAt]
  );
}

/**
 * Update cursor after failed ingestion
 */
export async function updateCursorFailure(
  orgId: string,
  walletId: number,
  errorCount: number,
  nextRunAt: Date
): Promise<void> {
  await pool.query(
    `
    UPDATE public.hl_ingest_cursor
    SET
      error_count = $3,
      status = 'error',
      next_run_at = $4
    WHERE org_id = $1 AND wallet_id = $2
    `,
    [orgId, walletId, errorCount, nextRunAt]
  );
}

/**
 * Delete cursor for a wallet
 */
export async function deleteCursor(
  orgId: string,
  walletId: number,
  client?: PoolClient
): Promise<void> {
  const queryExecutor = client ?? pool;

  await queryExecutor.query(
    `DELETE FROM public.hl_ingest_cursor WHERE org_id = $1 AND wallet_id = $2`,
    [orgId, walletId]
  );
}

/**
 * Get wallets due for ingestion
 */
export async function getWalletsDueForIngestion(
  orgId: string,
  hotThresholdHours: number,
  warmThresholdHours: number,
  limit: number
): Promise<Array<{
  org_id: string;
  wallet_id: number;
  address: string;
  last_trade_ts: Date | null;
  error_count: number;
  priority: 'hot' | 'warm' | 'cold';
}>> {
  const { rows } = await pool.query(
    `
    WITH wallet_activity AS (
      SELECT
        c.org_id,
        c.wallet_id,
        w.address,
        c.error_count,
        c.next_run_at,
        (
          SELECT MAX(last_trade_ts)
          FROM public.wallet_day_metrics wdm
          WHERE wdm.org_id = c.org_id AND wdm.wallet_id = c.wallet_id
        ) AS last_trade_ts
      FROM public.hl_ingest_cursor c
      JOIN public.wallets w ON w.id = c.wallet_id
      JOIN public.org_wallets ow ON ow.wallet_id = w.id AND ow.org_id = c.org_id
      WHERE c.org_id = $1
        AND w.is_active = true
    )
    SELECT
      org_id,
      wallet_id,
      address,
      last_trade_ts,
      error_count,
      CASE
        WHEN last_trade_ts > NOW() - INTERVAL '1 hour' * $2 THEN 'hot'
        WHEN last_trade_ts > NOW() - INTERVAL '1 hour' * $3 THEN 'warm'
        ELSE 'cold'
      END AS priority
    FROM wallet_activity
    WHERE next_run_at <= NOW()
    ORDER BY
      CASE
        WHEN last_trade_ts > NOW() - INTERVAL '1 hour' * $2 THEN 1
        WHEN last_trade_ts > NOW() - INTERVAL '1 hour' * $3 THEN 2
        ELSE 3
      END,
      next_run_at ASC
    LIMIT $4
    `,
    [orgId, hotThresholdHours, warmThresholdHours, limit]
  );

  return rows;
}

/**
 * Get the most recent trade timestamp for a wallet
 */
export async function getLastTradeTs(
  orgId: string,
  walletId: number
): Promise<Date | null> {
  const { rows } = await pool.query<{ last_trade_ts: Date | null }>(
    `
    SELECT MAX(last_trade_ts) AS last_trade_ts
    FROM public.wallet_day_metrics
    WHERE org_id = $1 AND wallet_id = $2
    `,
    [orgId, walletId]
  );

  return rows[0]?.last_trade_ts ?? null;
}

/**
 * Get scheduler statistics
 */
export async function getSchedulerStats(orgId: string): Promise<{
  total: number;
  hot: number;
  warm: number;
  cold: number;
  errored: number;
  dueNow: number;
}> {
  const { rows } = await pool.query(
    `
    WITH wallet_stats AS (
      SELECT
        c.wallet_id,
        c.error_count,
        c.next_run_at,
        (
          SELECT MAX(last_trade_ts)
          FROM public.wallet_day_metrics wdm
          WHERE wdm.org_id = c.org_id AND wdm.wallet_id = c.wallet_id
        ) AS last_trade_ts
      FROM public.hl_ingest_cursor c
      JOIN public.org_wallets ow ON ow.wallet_id = c.wallet_id AND ow.org_id = c.org_id
      JOIN public.wallets w ON w.id = c.wallet_id AND w.is_active = true
      WHERE c.org_id = $1
    )
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE last_trade_ts > NOW() - INTERVAL '24 hours')::int AS hot,
      COUNT(*) FILTER (
        WHERE last_trade_ts > NOW() - INTERVAL '168 hours'
        AND last_trade_ts <= NOW() - INTERVAL '24 hours'
      )::int AS warm,
      COUNT(*) FILTER (
        WHERE last_trade_ts IS NULL
        OR last_trade_ts <= NOW() - INTERVAL '168 hours'
      )::int AS cold,
      COUNT(*) FILTER (WHERE error_count > 0)::int AS errored,
      COUNT(*) FILTER (WHERE next_run_at <= NOW())::int AS due_now
    FROM wallet_stats
    `,
    [orgId]
  );

  return {
    total: rows[0].total,
    hot: rows[0].hot,
    warm: rows[0].warm,
    cold: rows[0].cold,
    errored: rows[0].errored,
    dueNow: rows[0].due_now,
  };
}