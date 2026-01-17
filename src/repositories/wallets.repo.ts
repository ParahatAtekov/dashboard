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
 * Insert a wallet or update label if exists
 * Returns the wallet ID and whether it was newly created
 */
export async function upsertWallet(
  address: string,
  label: string | null
): Promise<InsertWalletResult> {
  const { rows } = await pool.query<{ id: number; is_new: boolean }>(
    `
    WITH inserted AS (
      INSERT INTO public.wallets (address, label)
      VALUES ($1::citext, $2)
      ON CONFLICT (address) DO UPDATE SET
        label = COALESCE(EXCLUDED.label, wallets.label)
      RETURNING id, (xmax = 0) AS is_new
    )
    SELECT id, is_new FROM inserted
    `,
    [address, label]
  );

  return rows[0];
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
 * Get a wallet by address
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