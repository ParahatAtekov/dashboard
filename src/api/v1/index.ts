// src/api/v1/index.ts

import { Router, type IRouter } from 'express';
import { globalTimeseries } from './metrics.controller';
import { topWallets } from './wallets.controller';
import { dashboardSummary } from './dashboard.controller';
import {
  addWallet,
  addWalletsBulk,
  removeWallet,
  listWallets,
  validateWallet,
} from './wallets.registration.controller';

const router: IRouter = Router();

// Dashboard
router.get('/dashboard/summary', dashboardSummary);

// Metrics
router.get('/metrics/global', globalTimeseries);

// Wallet Analytics (existing)
router.get('/wallets/top', topWallets);

// Wallet Registration (new)
router.get('/wallets', listWallets);
router.post('/wallets', addWallet);
router.post('/wallets/bulk', addWalletsBulk);
router.post('/wallets/validate', validateWallet);
router.delete('/wallets/:walletId', removeWallet);

export default router;