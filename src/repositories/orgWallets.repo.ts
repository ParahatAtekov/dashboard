// src/repositories/orgWallets.repo.ts

import { pool } from '@/db/pool';
import { PoolClient } from 'pg';

export interface OrgWalletRow {
  org_id: string;
  wallet_id: number;
  added_by: string | null;
  created_at: Date;
}

export interface OrgWalletWithDetails {
  wallet_id: number;
  address: string;
  label: string | null;
  is_active: boolean;
  added_at: Date;
  last_ingested_at: Date | null;
  cursor_status: string | null;
  error_count: number;
}

/**
 * Link a wallet to an organization (idempotent)
 */
export async function linkWalletToOrg(
  orgId: string,
  walletId: number,
  addedBy: string,
  client?: PoolClient
): Promise<void> {
  const queryExecutor = client ?? pool;
  
  await queryExecutor.query(
    `
    INSERT INTO public.org_wallets (org_id, wallet_id, added_by)
    VALUES ($1, $2, $3)
    ON CONFLICT (org_id, wallet_id) DO NOTHING
    `,
    [orgId, walletId, addedBy]
  );
}

/**
 * Unlink a wallet from an organization
 * Returns true if a row was deleted
 */
export async function unlinkWalletFromOrg(
  orgId: string,
  walletId: number,
  client?: PoolClient
): Promise<boolean> {
  const queryExecutor = client ?? pool;
  
  const result = await queryExecutor.query(
    `
    DELETE FROM public.org_wallets
    WHERE org_id = $1 AND wallet_id = $2
    RETURNING wallet_id
    `,
    [orgId, walletId]
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Check if a wallet is linked to an organization
 */
export async function isWalletLinkedToOrg(
  orgId: string,
  walletId: number
): Promise<boolean> {
  const { rows } = await pool.query(
    `
    SELECT 1 FROM public.org_wallets
    WHERE org_id = $1 AND wallet_id = $2
    LIMIT 1
    `,
    [orgId, walletId]
  );

  return rows.length > 0;
}

/**
 * List all wallets for an organization with status info
 */
export async function listWalletsForOrg(
  orgId: string,
  limit: number,
  offset: number
): Promise<OrgWalletWithDetails[]> {
  const { rows } = await pool.query<OrgWalletWithDetails>(
    `
    SELECT
      w.id AS wallet_id,
      w.address,
      w.label,
      w.is_active,
      ow.created_at AS added_at,
      c.last_success_at AS last_ingested_at,
      c.status AS cursor_status,
      COALESCE(c.error_count, 0) AS error_count
    FROM public.org_wallets ow
    JOIN public.wallets w ON w.id = ow.wallet_id
    LEFT JOIN public.hl_ingest_cursor c ON c.org_id = ow.org_id AND c.wallet_id = ow.wallet_id
    WHERE ow.org_id = $1
    ORDER BY ow.created_at DESC
    LIMIT $2 OFFSET $3
    `,
    [orgId, limit, offset]
  );

  return rows;
}

/**
 * Count total wallets for an organization
 */
export async function countWalletsForOrg(orgId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM public.org_wallets WHERE org_id = $1`,
    [orgId]
  );

  return parseInt(rows[0].count, 10);
}

/**
 * Get wallet IDs that have pending ingestion jobs
 */
export async function getWalletIdsWithPendingJobs(
  orgId: string,
  walletIds: number[]
): Promise<Set<number>> {
  if (walletIds.length === 0) return new Set();

  const { rows } = await pool.query<{ wallet_id: number }>(
    `
    SELECT DISTINCT (payload->>'wallet_id')::bigint AS wallet_id
    FROM public.jobs
    WHERE org_id = $1
      AND type = 'ingest_wallet'
      AND status IN ('queued', 'running')
      AND (payload->>'wallet_id')::bigint = ANY($2)
    `,
    [orgId, walletIds]
  );

  return new Set(rows.map(r => r.wallet_id));
}