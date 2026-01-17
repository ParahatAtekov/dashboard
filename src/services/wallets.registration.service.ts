// src/services/wallets.registration.service.ts

import { pool } from '@/db/pool';
import * as walletsRepo from '@/repositories/wallets.repo';
import * as orgWalletsRepo from '@/repositories/orgWallets.repo';
import * as cursorRepo from '@/repositories/cursor.repo';
import * as jobsRepo from '@/repositories/jobs.repo';
import { hlClient } from '@/workers/ingest/hlClient';

// ============================================
// Types
// ============================================

export interface RegisterWalletInput {
  address: string;
  label?: string;
  triggerBackfill?: boolean;
}

export interface RegisterWalletResult {
  wallet_id: number;
  address: string;
  label: string | null;
  is_new: boolean;
  backfill_job_id?: number;
}

export interface BulkRegisterResult {
  successful: RegisterWalletResult[];
  failed: Array<{ address: string; error: string }>;
}

export interface ListWalletsResult {
  wallets: orgWalletsRepo.OrgWalletWithDetails[];
  total: number;
}

// ============================================
// Validation Helpers (no DB access)
// ============================================

export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

// ============================================
// Service Functions (business logic only)
// ============================================

/**
 * Register a single wallet for tracking
 */
export async function registerWallet(
  orgId: string,
  userId: string,
  input: RegisterWalletInput
): Promise<RegisterWalletResult> {
  const { label, triggerBackfill = true } = input;
  const address = normalizeAddress(input.address);

  // Validate
  if (!isValidAddress(address)) {
    throw new Error('Invalid Ethereum address format');
  }

  // Transaction for atomicity
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Step 1: Upsert wallet
    const walletResult = await walletsRepo.upsertWallet(address, label ?? null);
    const { id: walletId, is_new: isNew } = walletResult;

    // Step 2: Link to org
    await orgWalletsRepo.linkWalletToOrg(orgId, walletId, userId, client);

    // Step 3: Initialize cursor
    await cursorRepo.initializeCursor(orgId, walletId, client);

    await client.query('COMMIT');

    // Step 4: Trigger backfill (outside transaction)
    let backfillJobId: number | undefined;
    if (triggerBackfill) {
      backfillJobId = await jobsRepo.createJob(orgId, 'ingest_wallet', {
        org_id: orgId,
        wallet_id: walletId,
        address: address,
      });
    }

    return {
      wallet_id: walletId,
      address,
      label: label ?? null,
      is_new: isNew,
      backfill_job_id: backfillJobId,
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Register multiple wallets at once
 */
export async function registerWalletsBulk(
  orgId: string,
  userId: string,
  wallets: RegisterWalletInput[]
): Promise<BulkRegisterResult> {
  const successful: RegisterWalletResult[] = [];
  const failed: Array<{ address: string; error: string }> = [];

  for (const wallet of wallets) {
    try {
      const result = await registerWallet(orgId, userId, wallet);
      successful.push(result);
    } catch (error) {
      failed.push({
        address: wallet.address,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return { successful, failed };
}

/**
 * Remove a wallet from tracking
 */
export async function unregisterWallet(
  orgId: string,
  walletId: number
): Promise<{ success: boolean; address?: string }> {
  // Get wallet info first
  const wallet = await walletsRepo.findWalletById(walletId);
  if (!wallet) {
    throw new Error('Wallet not found');
  }

  // Check if linked to org
  const isLinked = await orgWalletsRepo.isWalletLinkedToOrg(orgId, walletId);
  if (!isLinked) {
    throw new Error('Wallet not linked to this organization');
  }

  // Transaction for atomicity
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Unlink from org
    await orgWalletsRepo.unlinkWalletFromOrg(orgId, walletId, client);

    // Delete cursor
    await cursorRepo.deleteCursor(orgId, walletId, client);

    // Cancel pending jobs
    await jobsRepo.cancelWalletJobs(orgId, walletId, client);

    await client.query('COMMIT');

    return {
      success: true,
      address: wallet.address,
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * List all wallets for an organization
 */
export async function listOrgWallets(
  orgId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<ListWalletsResult> {
  const { limit = 50, offset = 0 } = options;

  const [wallets, total] = await Promise.all([
    orgWalletsRepo.listWalletsForOrg(orgId, limit, offset),
    orgWalletsRepo.countWalletsForOrg(orgId),
  ]);

  return { wallets, total };
}

/**
 * Validate wallet exists on HyperLiquid (optional pre-check)
 */
export async function validateWalletOnHyperLiquid(
  address: string
): Promise<{ valid: boolean; hasActivity: boolean; error?: string }> {
  try {
    const normalizedAddress = normalizeAddress(address);

    const fills = await hlClient.userFillsByTime({
      user: normalizedAddress,
      startTime: Date.now() - 30 * 24 * 60 * 60 * 1000,
    });

    return {
      valid: true,
      hasActivity: fills.length > 0,
    };
  } catch (error) {
    return {
      valid: false,
      hasActivity: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}