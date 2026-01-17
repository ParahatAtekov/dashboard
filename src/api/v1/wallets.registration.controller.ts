// src/api/v1/wallets.registration.controller.ts

import { Request, Response } from 'express';
import {
  registerWallet,
  registerWalletsBulk,
  unregisterWallet,
  listOrgWallets,
  validateWalletOnHyperLiquid,
  isValidAddress,
} from '@/services/wallets.registration.service';

/**
 * POST /api/v1/wallets
 */
export async function addWallet(req: Request, res: Response) {
  try {
    const orgId = req.user?.orgId;
    const userId = req.user?.userId;

    if (!orgId || !userId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const { address, label, triggerBackfill } = req.body;

    if (!address) {
      res.status(400).json({ error: 'address_required' });
      return;
    }

    if (!isValidAddress(address)) {
      res.status(400).json({ error: 'invalid_address_format' });
      return;
    }

    const result = await registerWallet(orgId, userId, {
      address,
      label,
      triggerBackfill: triggerBackfill ?? true,
    });

    res.status(result.is_new ? 201 : 200).json(result);
  } catch (error) {
    console.error('Add wallet error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'internal_error', message });
  }
}

/**
 * POST /api/v1/wallets/bulk
 */
export async function addWalletsBulk(req: Request, res: Response) {
  try {
    const orgId = req.user?.orgId;
    const userId = req.user?.userId;

    if (!orgId || !userId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const { wallets } = req.body;

    if (!Array.isArray(wallets) || wallets.length === 0) {
      res.status(400).json({ error: 'wallets_array_required' });
      return;
    }

    if (wallets.length > 100) {
      res.status(400).json({ error: 'max_100_wallets_per_request' });
      return;
    }

    const result = await registerWalletsBulk(orgId, userId, wallets);

    res.status(200).json({
      total: wallets.length,
      successful: result.successful.length,
      failed: result.failed.length,
      results: result,
    });
  } catch (error) {
    console.error('Bulk add wallets error:', error);
    res.status(500).json({ error: 'internal_error' });
  }
}

/**
 * DELETE /api/v1/wallets/:walletId
 */
export async function removeWallet(req: Request, res: Response) {
  try {
    const orgId = req.user?.orgId;

    if (!orgId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const walletIdParam = Array.isArray(req.params.walletId)
      ? req.params.walletId[0]
      : req.params.walletId;

    const walletId = parseInt(walletIdParam);

    if (isNaN(walletId)) {
      res.status(400).json({ error: 'invalid_wallet_id' });
      return;
    }

    const result = await unregisterWallet(orgId, walletId);

    res.status(200).json(result);
  } catch (error) {
    console.error('Remove wallet error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message === 'Wallet not found' || message === 'Wallet not linked to this organization') {
      res.status(404).json({ error: 'wallet_not_found', message });
      return;
    }

    res.status(500).json({ error: 'internal_error', message });
  }
}

/**
 * GET /api/v1/wallets
 */
export async function listWallets(req: Request, res: Response) {
  try {
    const orgId = req.user?.orgId;

    if (!orgId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await listOrgWallets(orgId, { limit, offset });

    res.setHeader('Cache-Control', 'private, max-age=10');
    res.status(200).json(result);
  } catch (error) {
    console.error('List wallets error:', error);
    res.status(500).json({ error: 'internal_error' });
  }
}

/**
 * POST /api/v1/wallets/validate
 */
export async function validateWallet(req: Request, res: Response) {
  try {
    const { address } = req.body;

    if (!address) {
      res.status(400).json({ error: 'address_required' });
      return;
    }

    if (!isValidAddress(address)) {
      res.status(400).json({
        error: 'invalid_address_format',
        valid: false,
        hasActivity: false,
      });
      return;
    }

    const result = await validateWalletOnHyperLiquid(address);

    res.status(200).json(result);
  } catch (error) {
    console.error('Validate wallet error:', error);
    res.status(500).json({ error: 'internal_error' });
  }
}