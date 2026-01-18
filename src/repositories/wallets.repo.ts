// src/repositories/wallets.repo.ts

import { pool } from '@/db/pool';

export interface WalletRow {
  id: number;
  address: string;
  label: string | null;
  is_active: boolean;
  created_at: Date;
}

export interface InsertWalletResult {
  id: number;
  is_new: boolean;
}

/**
 * Insert a wallet or update label if exists.
 * 
 * Label behavior:
 * - `label = undefined` → preserve existing label on conflict
 * - `label = null` → clear existing label on conflict  
 * - `label = "string"` → set new label on conflict
 * 
 * Returns the wallet ID and whether it was newly created.
 */
export async function upsertWallet(
  address: string,
  label?: string | null
): Promise<InsertWalletResult> {
  // If label is explicitly undefined, we preserve existing on conflict
  // If label is null or a string, we use that value
  const shouldUpdateLabel = label !== undefined;
  
  if (shouldUpdateLabel) {
    // Label was explicitly provided (could be null or a string)
    const { rows } = await pool.query<{ id: number; is_new: boolean }>(
      `
      WITH inserted AS (
        INSERT INTO public.wallets (address, label)
        VALUES ($1::citext, $2)
        ON CONFLICT (address) DO UPDATE SET
          label = $2
        RETURNING id, (xmax = 0) AS is_new
      )
      SELECT id, is_new FROM inserted
      `,
      [address, label]
    );
    return rows[0];
  } else {
    // Label was undefined - preserve existing on conflict
    const { rows } = await pool.query<{ id: number; is_new: boolean }>(
      `
      WITH inserted AS (
        INSERT INTO public.wallets (address, label)
        VALUES ($1::citext, NULL)
        ON CONFLICT (address) DO NOTHING
        RETURNING id, true AS is_new
      ),
      existing AS (
        SELECT id, false AS is_new
        FROM public.wallets
        WHERE address = $1::citext
          AND NOT EXISTS (SELECT 1 FROM inserted)
      )
      SELECT id, is_new FROM inserted
      UNION ALL
      SELECT id, is_new FROM existing
      `,
      [address]
    );
    return rows[0];
  }
}

/**
 * Get a wallet by ID
 */
export async function findWalletById(walletId: number): Promise<WalletRow | null> {
  const { rows } = await pool.query<WalletRow>(
    `SELECT id, address, label, is_active, created_at FROM public.wallets WHERE id = $1`,
    [walletId]
  );

  return rows[0] ?? null;
}

/**
 * Get a wallet by address (case-insensitive)
 */
export async function findWalletByAddress(address: string): Promise<WalletRow | null> {
  const { rows } = await pool.query<WalletRow>(
    `SELECT id, address, label, is_active, created_at FROM public.wallets WHERE address = $1::citext`,
    [address]
  );

  return rows[0] ?? null;
}

/**
 * Update wallet active status
 */
export async function updateWalletActive(
  walletId: number,
  isActive: boolean
): Promise<void> {
  await pool.query(
    `UPDATE public.wallets SET is_active = $2 WHERE id = $1`,
    [walletId, isActive]
  );
}

/**
 * Update wallet label
 * Pass null to clear the label
 */
export async function updateWalletLabel(
  walletId: number,
  label: string | null
): Promise<void> {
  await pool.query(
    `UPDATE public.wallets SET label = $2 WHERE id = $1`,
    [walletId, label]
  );
}

/**
 * Check if wallet exists by address
 */
export async function walletExistsByAddress(address: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM public.wallets WHERE address = $1::citext) AS exists`,
    [address]
  );
  return rows[0].exists;
}